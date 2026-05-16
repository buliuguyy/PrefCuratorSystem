"use client";

import { useEffect, useRef, useState } from "react";

import { useCurator } from "@/store/useCurator";
import { SmartTagPopover } from "@/components/SmartTagPopover/SmartTagPopover";
import { LassoOverlay } from "@/components/LassoOverlay/LassoOverlay";
import { PolygonOverlay } from "@/components/LassoOverlay/PolygonOverlay";
import type { Asset, CanvasItem } from "@/types";

import styles from "./Canvas.module.css";

/**
 * Freeform Canvas with the following interaction model:
 *
 *   Pan       middle-mouse drag · Alt+left drag · wheel (vertical) · shift+wheel (horiz)
 *   Zoom      Cmd/Ctrl + wheel, centered on cursor
 *   Select    Shift+click a tile to toggle into the selection set
 *             Click empty space to clear selection
 *   Move      Drag any tile. If that tile is in the selection, the whole
 *             selection moves together; otherwise the selection is replaced
 *             with just that tile and only it moves.
 *   Smart Tag Click (not drag) any tile.
 *
 * Drag vs click is distinguished by DRAG_THRESHOLD px.
 */

const DRAG_THRESHOLD = 4;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;

async function downloadAsset(asset: Asset): Promise<void> {
  // Fetch as Blob so both backend URLs (cross-origin) and mock data URLs
  // trigger a Save dialog with the correct content-type — direct anchor
  // download on a cross-origin URL just navigates instead of saving.
  const res = await fetch(asset.url);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const ext = (blob.type.split("/")[1] || "png").split(";")[0];
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = `${asset.label || asset.id}.${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

interface PanDrag {
  kind: "pan";
  startX: number;
  startY: number;
  origPanX: number;
  origPanY: number;
  moved: boolean;
}
interface TileDrag {
  kind: "tile";
  startX: number;
  startY: number;
  /** Original positions of every tile being moved (single or multi). */
  origPositions: Record<string, { x: number; y: number }>;
  primaryAssetId: string;
  moved: boolean;
}
type DragRef = PanDrag | TileDrag;

function isPanGesture(e: React.PointerEvent): boolean {
  // middle mouse OR alt+left
  return e.button === 1 || (e.button === 0 && e.altKey);
}

export function Canvas() {
  const items = useCurator((s) => s.canvasItems);
  const assets = useCurator((s) => s.assets);
  const pan = useCurator((s) => s.canvasPan);
  const zoom = useCurator((s) => s.canvasZoom);
  const selectedAssetIds = useCurator((s) => s.selectedAssetIds);
  const setPan = useCurator((s) => s.setCanvasPan);
  const setZoom = useCurator((s) => s.setCanvasZoom);
  const moveItems = useCurator((s) => s.moveCanvasItems);
  const raise = useCurator((s) => s.raiseCanvasItem);
  const toggleSelect = useCurator((s) => s.toggleSelectAsset);
  const clearSelection = useCurator((s) => s.clearSelection);
  const loading = useCurator((s) => s.loadingCandidates);
  const setOriginalDims = useCurator((s) => s.setOriginalDims);
  const startLasso = useCurator((s) => s.startLasso);
  const cancelLasso = useCurator((s) => s.cancelLasso);
  const lassoMode = useCurator((s) => s.lassoMode);
  const activePopoverAssetId = useCurator((s) => s.activePopoverAssetId);
  const setActivePopover = useCurator((s) => s.setActivePopover);
  const setPreview = useCurator((s) => s.setPreview);
  const taggingAssets = useCurator((s) => s.taggingAssets);
  const finalAssetId = useCurator((s) => s.finalAssetId);
  const setFinalAsset = useCurator((s) => s.setFinalAsset);

  const [ctxMenu, setCtxMenu] = useState<
    { assetId: string; clientX: number; clientY: number } | null
  >(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragRef | null>(null);

  // ─── pointer handlers ────────────────────────────────────────────────────

  function onViewportPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return; // child handled it
    e.preventDefault();

    if (isPanGesture(e)) {
      dragRef.current = {
        kind: "pan",
        startX: e.clientX,
        startY: e.clientY,
        origPanX: pan.x,
        origPanY: pan.y,
        moved: false,
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    if (e.button === 0) {
      // plain left click on empty → clear selection (treat the down as a
      // potential click; if pointer moves we treat as pan with no modifier
      // — but with the new model, plain-left-drag on empty does nothing).
      dragRef.current = {
        kind: "pan",
        startX: e.clientX,
        startY: e.clientY,
        origPanX: pan.x,
        origPanY: pan.y,
        moved: false,
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      // we'll decide click-vs-drag in onPointerUp
    }
  }

  function onTilePointerDown(
    e: React.PointerEvent<HTMLButtonElement>,
    item: CanvasItem,
  ) {
    // alt+left or middle on a tile still pans the canvas (bubble up via stop=false)
    if (isPanGesture(e)) {
      // we want the pan to start from the viewport, not the tile
      return; // let the viewport handler take it... but the event already bubbled
    }
    if (e.button !== 0) return;
    e.stopPropagation();

    if (e.shiftKey) {
      // Shift+click: toggle selection. Don't initiate drag.
      toggleSelect(item.assetId);
      return;
    }

    raise(item.assetId);

    // If this tile is in the current selection, drag the whole group;
    // otherwise drag just this tile (selection is untouched — selection is
    // only created/removed via shift+click).
    const inSelection = selectedAssetIds.includes(item.assetId);
    const draggingIds = inSelection ? selectedAssetIds : [item.assetId];

    const origPositions: Record<string, { x: number; y: number }> = {};
    for (const id of draggingIds) {
      const it = items.find((x) => x.assetId === id);
      if (it) origPositions[id] = { x: it.x, y: it.y };
    }

    dragRef.current = {
      kind: "tile",
      startX: e.clientX,
      startY: e.clientY,
      origPositions,
      primaryAssetId: item.assetId,
      moved: false,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) d.moved = true;
    if (!d.moved) return;

    if (d.kind === "pan") {
      setPan(d.origPanX + dx, d.origPanY + dy);
    } else {
      // tile drag — convert screen delta to world delta (inverse zoom).
      const wdx = dx / zoom;
      const wdy = dy / zoom;
      const deltas = Object.entries(d.origPositions).map(([assetId, p]) => ({
        assetId,
        x: p.x + wdx,
        y: p.y + wdy,
      }));
      moveItems(deltas);
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const wasDrag = d.moved;
    dragRef.current = null;

    if (!wasDrag) {
      if (d.kind === "tile") {
        // click on a tile (not a drag) → open Preview overlay. Tagging now
        // lives behind right-click → Tag so a stray click while a pre-tag
        // is in flight can't race with the user's own request.
        setPreview(d.primaryAssetId);
      } else if (d.kind === "pan") {
        // click on empty → clear selection (only if we used left button on empty)
        if (selectedAssetIds.length > 0) clearSelection();
      }
    }
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* not captured */
    }
  }

  // wheel: pan (default) · shift+wheel = horizontal pan · cmd/ctrl+wheel = zoom
  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    function onWheel(e: WheelEvent) {
      if (e.ctrlKey || e.metaKey) {
        // ZOOM at cursor
        e.preventDefault();
        const rect = node!.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const scale = Math.exp(-e.deltaY * 0.0015); // smooth multiplicative
        const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * scale));
        if (next === zoom) return;
        // keep the world point under cursor stationary
        const worldX = (cx - pan.x) / zoom;
        const worldY = (cy - pan.y) / zoom;
        setPan(cx - worldX * next, cy - worldY * next);
        setZoom(next);
        return;
      }
      // PAN — honor both axes so Mac trackpad's two-finger horizontal swipe
      // (which delivers deltaX directly) works without modifiers. Shift+wheel
      // still maps a vertical-only mouse wheel onto horizontal pan.
      e.preventDefault();
      let dx = -e.deltaX;
      let dy = -e.deltaY;
      if (e.shiftKey && Math.abs(e.deltaX) < 1) {
        dx = -e.deltaY;
        dy = 0;
      }
      setPan(pan.x + dx, pan.y + dy);
    }
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [pan.x, pan.y, zoom, setPan, setZoom]);

  // keyboard pan / zoom — runs at window-level so the canvas doesn't need
  // focus. Skipped when the user is typing in an input.
  useEffect(() => {
    function isTypingTarget(el: EventTarget | null): boolean {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      return el.isContentEditable;
    }
    function zoomAt(cx: number, cy: number, factor: number) {
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
      if (next === zoom) return;
      const wx = (cx - pan.x) / zoom;
      const wy = (cy - pan.y) / zoom;
      setPan(cx - wx * next, cy - wy * next);
      setZoom(next);
    }
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      // ignore when a modifier other than Shift is held (Cmd-arrow / Ctrl-arrow
      // are word-nav shortcuts in many tools; don't steal them)
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const node = viewportRef.current;
      const step = e.shiftKey ? 120 : 40;
      switch (e.key) {
        case "ArrowLeft":
          setPan(pan.x + step, pan.y);
          e.preventDefault();
          break;
        case "ArrowRight":
          setPan(pan.x - step, pan.y);
          e.preventDefault();
          break;
        case "ArrowUp":
          setPan(pan.x, pan.y + step);
          e.preventDefault();
          break;
        case "ArrowDown":
          setPan(pan.x, pan.y - step);
          e.preventDefault();
          break;
        case "+":
        case "=": {
          if (!node) return;
          const r = node.getBoundingClientRect();
          zoomAt(r.width / 2, r.height / 2, 1.15);
          e.preventDefault();
          break;
        }
        case "-":
        case "_": {
          if (!node) return;
          const r = node.getBoundingClientRect();
          zoomAt(r.width / 2, r.height / 2, 1 / 1.15);
          e.preventDefault();
          break;
        }
        case "0":
          setPan(0, 0);
          setZoom(1);
          e.preventDefault();
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pan.x, pan.y, zoom, setPan, setZoom]);

  // prevent browser context menu on middle / right clicks so middle-drag pan
  // doesn't get stolen by autoscroll
  function onContextMenu(e: React.MouseEvent) {
    e.preventDefault();
  }

  function onTileContextMenu(
    e: React.MouseEvent<HTMLButtonElement>,
    item: CanvasItem,
  ) {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({
      assetId: item.assetId,
      clientX: e.clientX,
      clientY: e.clientY,
    });
  }

  // close ctx menu on outside click / scroll / blur / Esc; Esc also cancels lasso draw
  useEffect(() => {
    const close = () => setCtxMenu(null);
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (ctxMenu) setCtxMenu(null);
        if (lassoMode) cancelLasso();
      }
    }
    window.addEventListener("scroll", close, true);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [ctxMenu, lassoMode, cancelLasso]);

  if (loading && items.length === 0) {
    return (
      <div className={styles.viewport}>
        <div className={styles.skeletonGrid}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={styles.skeletonTile} />
          ))}
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyMark}>✦</div>
        <p>Enter a prompt above and click <strong>Generate</strong>.</p>
        <p className={styles.emptyHint}>
          Generated and composed images live on this canvas as draggable
          tiles. Every tile can be smart-tagged and fed into the next compose.
        </p>
      </div>
    );
  }

  const ordered = [...items].sort((a, b) => a.z - b.z);

  return (
    <>
      <div
        ref={viewportRef}
        className={styles.viewport}
        onPointerDown={onViewportPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={onContextMenu}
        data-pannable
      >
        <div
          className={styles.world}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
        >
          {ordered.map((it) => {
            const asset = assets[it.assetId];
            if (!asset) return null;
            return (
              <Tile
                key={it.assetId}
                item={it}
                asset={asset}
                selected={selectedAssetIds.includes(it.assetId)}
                onPointerDown={(e) => onTilePointerDown(e, it)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onContextMenu={(e) => onTileContextMenu(e, it)}
                onImgLoad={(e) => {
                  const img = e.currentTarget;
                  if (img.naturalWidth && img.naturalHeight) {
                    setOriginalDims(
                      asset.id,
                      img.naturalWidth,
                      img.naturalHeight,
                    );
                  }
                }}
              />
            );
          })}
          {/* persisted dashed-polygon overlays inside .world so they pan/zoom with the canvas */}
          {items.map((it) => {
            const a = assets[it.assetId];
            if (!a) return null;
            return (
              <PolygonOverlay
                key={`poly-${it.assetId}`}
                parentItem={it}
                parentAsset={a}
                zoom={zoom}
                onClick={(lassoAssetId) => setActivePopover(lassoAssetId)}
              />
            );
          })}
        </div>

        <div className={styles.zoomChip}>
          <button
            className={styles.zoomBtn}
            onClick={() => {
              const r = viewportRef.current!.getBoundingClientRect();
              const cx = r.width / 2;
              const cy = r.height / 2;
              const next = Math.max(MIN_ZOOM, zoom / 1.2);
              const wx = (cx - pan.x) / zoom;
              const wy = (cy - pan.y) / zoom;
              setPan(cx - wx * next, cy - wy * next);
              setZoom(next);
            }}
            aria-label="zoom out"
          >
            −
          </button>
          <span className={styles.zoomVal}>{Math.round(zoom * 100)}%</span>
          <button
            className={styles.zoomBtn}
            onClick={() => {
              const r = viewportRef.current!.getBoundingClientRect();
              const cx = r.width / 2;
              const cy = r.height / 2;
              const next = Math.min(MAX_ZOOM, zoom * 1.2);
              const wx = (cx - pan.x) / zoom;
              const wy = (cy - pan.y) / zoom;
              setPan(cx - wx * next, cy - wy * next);
              setZoom(next);
            }}
            aria-label="zoom in"
          >
            +
          </button>
          <button
            className={styles.zoomBtn}
            onClick={() => {
              setPan(0, 0);
              setZoom(1);
            }}
            title="reset view"
            aria-label="reset view"
          >
            ⤧
          </button>
        </div>

        <div className={styles.panHint}>
          click tile → preview · right-click tile → Tag / Lasso / Save · middle-drag · Alt+drag · ⌘/Ctrl+wheel zoom · arrows pan · +/− zoom · 0 reset · Shift-click multi-select
        </div>

        {selectedAssetIds.length > 0 && (
          <div className={styles.selChip}>
            {selectedAssetIds.length} selected
            <button className={styles.selClearBtn} onClick={clearSelection}>
              clear
            </button>
          </div>
        )}

        {lassoMode && (
          <LassoOverlay
            sourceAssetId={lassoMode.sourceAssetId}
            viewportRef={viewportRef}
          />
        )}

        {loading && items.length > 0 && (
          <div className={styles.regenBanner}>
            <span className={styles.regenBannerSpinner} />
            <span>Generating new candidates…</span>
            <span className={styles.regenDots}>
              <span className={styles.regenDot} />
              <span className={styles.regenDot} />
              <span className={styles.regenDot} />
              <span className={styles.regenDot} />
            </span>
          </div>
        )}
      </div>

      {ctxMenu && (
        <div
          className={styles.ctxMenu}
          style={{ left: ctxMenu.clientX, top: ctxMenu.clientY }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className={styles.ctxItem}
            onClick={() => {
              setActivePopover(ctxMenu.assetId);
              setCtxMenu(null);
            }}
          >
            <span className={styles.ctxIcon}>◎</span>
            {taggingAssets[ctxMenu.assetId] ? (
              <>
                Tagging
                <span className={styles.dots} aria-hidden>
                  <span className={styles.dot} />
                  <span className={styles.dot} />
                  <span className={styles.dot} />
                </span>
              </>
            ) : (
              <>Smart tag</>
            )}
          </button>
          <button
            className={styles.ctxItem}
            onClick={() => {
              startLasso(ctxMenu.assetId);
              setCtxMenu(null);
            }}
          >
            <span className={styles.ctxIcon}>✂</span>
            Lasso this image
          </button>
          <button
            className={styles.ctxItem}
            onClick={() => {
              const a = assets[ctxMenu.assetId];
              if (a) void downloadAsset(a);
              setCtxMenu(null);
            }}
          >
            <span className={styles.ctxIcon}>⬇</span>
            Save to local
          </button>
          <button
            className={styles.ctxItem}
            onClick={() => {
              setFinalAsset(
                finalAssetId === ctxMenu.assetId ? null : ctxMenu.assetId,
              );
              setCtxMenu(null);
            }}
          >
            <span className={styles.ctxIcon}>★</span>
            {finalAssetId === ctxMenu.assetId
              ? "Unpin from final"
              : "Pin as final"}
          </button>
        </div>
      )}

      {/* clicking the backdrop closes the ctx menu — render a transparent
          full-viewport catcher under the menu so the user doesn't have to hit
          a precise spot */}
      {ctxMenu && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 35,
          }}
          onPointerDown={() => setCtxMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setCtxMenu(null);
          }}
        />
      )}

      {activePopoverAssetId && (
        <SmartTagPopover
          assetId={activePopoverAssetId}
          onClose={() => setActivePopover(null)}
        />
      )}
    </>
  );
}

interface TileProps {
  item: CanvasItem;
  asset: Asset;
  selected: boolean;
  onPointerDown(e: React.PointerEvent<HTMLButtonElement>): void;
  onPointerMove(e: React.PointerEvent): void;
  onPointerUp(e: React.PointerEvent): void;
  onContextMenu(e: React.MouseEvent<HTMLButtonElement>): void;
  onImgLoad(e: React.SyntheticEvent<HTMLImageElement>): void;
}

function Tile({
  item,
  asset,
  selected,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onContextMenu,
  onImgLoad,
}: TileProps) {
  const composed = asset.origin === "composed";
  const lasso = asset.origin === "lasso";
  return (
    <button
      className={[
        styles.tile,
        composed ? styles.tileComposed : "",
        selected ? styles.tileSelected : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        left: item.x,
        top: item.y,
        width: item.width,
        height: item.height,
        zIndex: item.z,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={onContextMenu}
      data-asset-id={asset.id}
      data-origin={asset.origin}
    >
      <img
        src={asset.url}
        alt={asset.label}
        className={styles.tileImg}
        draggable={false}
        onLoad={onImgLoad}
      />
      <span className={styles.tileLabel}>
        {composed && <span className={styles.composedMark}>✦</span>}
        {lasso && <span className={styles.composedMark}>✂</span>}
        {asset.label}
      </span>
      {selected && <span className={styles.selectMark}>✓</span>}
    </button>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";

import { useCurator } from "@/store/useCurator";
import { SmartTagPopover } from "@/components/SmartTagPopover/SmartTagPopover";
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

  const [activeAssetId, setActiveAssetId] = useState<string | null>(null);
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
        // click on a tile (not a drag) → open Smart Tag
        setActiveAssetId(d.primaryAssetId);
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
      // PAN
      e.preventDefault();
      const dx = e.shiftKey ? -e.deltaY : 0;
      const dy = e.shiftKey ? 0 : -e.deltaY;
      setPan(pan.x + dx, pan.y + dy);
    }
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [pan.x, pan.y, zoom, setPan, setZoom]);

  // prevent browser context menu on middle / right clicks so middle-drag pan
  // doesn't get stolen by autoscroll
  function onContextMenu(e: React.MouseEvent) {
    e.preventDefault();
  }

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
          middle-drag or Alt+drag to pan · ⌘/Ctrl+wheel to zoom · Shift-click to multi-select · click tile to smart-tag
        </div>

        {selectedAssetIds.length > 0 && (
          <div className={styles.selChip}>
            {selectedAssetIds.length} selected
            <button className={styles.selClearBtn} onClick={clearSelection}>
              clear
            </button>
          </div>
        )}
      </div>

      {activeAssetId && (
        <SmartTagPopover
          assetId={activeAssetId}
          onClose={() => setActiveAssetId(null)}
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
}

function Tile({
  item,
  asset,
  selected,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: TileProps) {
  const composed = asset.origin === "composed";
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
    >
      <img
        src={asset.url}
        alt={asset.label}
        className={styles.tileImg}
        draggable={false}
      />
      <span className={styles.tileLabel}>
        {composed && <span className={styles.composedMark}>✦</span>}
        {asset.label}
      </span>
      {selected && <span className={styles.selectMark}>✓</span>}
    </button>
  );
}

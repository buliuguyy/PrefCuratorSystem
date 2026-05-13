"use client";

/**
 * Active free-draw polygon drawing layer. Mounted when
 * useCurator().lassoMode is non-null. Renders a fixed-positioned SVG over the
 * source tile's screen rect; collects vertices via click + freehand drag, and
 * commits to the store on close.
 *
 * Coordinate flow:
 *   pointer event clientX/Y
 *   → subtract overlay rect origin → stage-pixel point (0..overlayW, 0..overlayH)
 *   → on commit: (stage_x / overlayW) * originalW → image-pixel
 *
 * Stage-pixel coords are stored during drawing so the rubber-band line follows
 * the cursor pixel-for-pixel regardless of canvas zoom.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { useCurator } from "@/store/useCurator";

import styles from "./LassoOverlay.module.css";

const CLOSE_THRESHOLD = 10; // px (stage-pixel) — click within this of vertex 0 closes
const DRAG_FREEHAND_THRESHOLD = 6; // px — pointermove must travel this far for a freehand vertex

interface Props {
  sourceAssetId: string;
  viewportRef: React.RefObject<HTMLDivElement | null>;
}

export function LassoOverlay({ sourceAssetId, viewportRef }: Props) {
  const asset = useCurator((s) => s.assets[sourceAssetId]);
  const item = useCurator((s) =>
    s.canvasItems.find((it) => it.assetId === sourceAssetId),
  );
  const pan = useCurator((s) => s.canvasPan);
  const zoom = useCurator((s) => s.canvasZoom);
  const cancelLasso = useCurator((s) => s.cancelLasso);
  const commitLasso = useCurator((s) => s.commitLasso);

  const [points, setPoints] = useState<[number, number][]>([]);
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragOriginRef = useRef<[number, number] | null>(null);

  // overlay screen rect: derived from tile world rect → viewport-relative pixels
  const rect = useMemo(() => {
    if (!item || !viewportRef.current) return null;
    const vp = viewportRef.current.getBoundingClientRect();
    const left = vp.left + pan.x + item.x * zoom;
    const top = vp.top + pan.y + item.y * zoom;
    const width = item.width * zoom;
    const height = item.height * zoom;
    return { left, top, width, height };
  }, [item, pan.x, pan.y, zoom, viewportRef]);

  // Esc cancel / Enter close — global listeners
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelLasso();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (points.length >= 3) commit(points);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points]);

  if (!asset || !item || !rect) return null;

  function clientToStage(clientX: number, clientY: number): [number, number] {
    return [clientX - rect!.left, clientY - rect!.top];
  }

  function stageToImage(p: [number, number]): [number, number] {
    const W = asset!.originalW ?? rect!.width;
    const H = asset!.originalH ?? rect!.height;
    return [(p[0] / rect!.width) * W, (p[1] / rect!.height) * H];
  }

  function commit(stagePts: [number, number][]) {
    if (stagePts.length < 3) {
      cancelLasso();
      return;
    }
    const imgPts = stagePts.map(stageToImage);
    commitLasso(imgPts);
  }

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    // ignore non-primary; right click cancels
    if (e.button === 2) {
      cancelLasso();
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const sp = clientToStage(e.clientX, e.clientY);

    // close if clicking near vertex 0
    if (points.length >= 3) {
      const [x0, y0] = points[0];
      if (Math.hypot(sp[0] - x0, sp[1] - y0) <= CLOSE_THRESHOLD) {
        commit(points);
        return;
      }
    }

    setPoints((prev) => [...prev, sp]);
    dragOriginRef.current = sp;
    svgRef.current?.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const sp = clientToStage(e.clientX, e.clientY);
    setCursor(sp);

    // freehand: only insert a new vertex if pointer captured AND moved far enough
    const origin = dragOriginRef.current;
    if (origin) {
      const dx = sp[0] - origin[0];
      const dy = sp[1] - origin[1];
      if (Math.hypot(dx, dy) >= DRAG_FREEHAND_THRESHOLD) {
        setPoints((prev) => [...prev, sp]);
        dragOriginRef.current = sp;
      }
    }
  }

  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    dragOriginRef.current = null;
    try {
      svgRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* not captured */
    }
  }

  function onDoubleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (points.length >= 3) commit(points);
  }

  const livePts = cursor ? [...points, cursor] : points;
  const polyStr = livePts.map((p) => `${p[0]},${p[1]}`).join(" ");
  const closedHint =
    points.length >= 3 && cursor &&
    Math.hypot(cursor[0] - points[0][0], cursor[1] - points[0][1]) <=
      CLOSE_THRESHOLD;

  return (
    <>
      {/* dim everything else so users see they're in lasso mode */}
      <div
        className={styles.backdrop}
        onPointerDown={(e) => e.stopPropagation()}
      />
      <svg
        ref={svgRef}
        className={styles.stage}
        style={{
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        }}
        viewBox={`0 0 ${rect.width} ${rect.height}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => {
          e.preventDefault();
          cancelLasso();
        }}
      >
        {/* polyline so far + rubber band to cursor */}
        {livePts.length >= 2 && (
          <polyline
            className={styles.poly}
            points={polyStr}
            fill={closedHint ? "rgba(245, 164, 93, 0.16)" : "none"}
          />
        )}
        {/* vertex handles */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p[0]}
            cy={p[1]}
            r={i === 0 ? 5 : 3.5}
            className={
              i === 0 && closedHint ? styles.vertexClose : styles.vertex
            }
          />
        ))}
      </svg>

      <div className={styles.hint}>
        click to drop a vertex · drag to freehand · click near the first vertex,
        press <kbd>Enter</kbd>, or double-click to close · <kbd>Esc</kbd> to cancel
      </div>
    </>
  );
}

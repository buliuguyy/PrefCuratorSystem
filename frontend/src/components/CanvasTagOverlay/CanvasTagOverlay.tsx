"use client";

import { useCurator } from "@/store/useCurator";
import {
  accentForConcept,
  type Asset,
  type CanvasItem,
  type ConceptTag,
  type Sign,
} from "@/types";

import styles from "./CanvasTagOverlay.module.css";

/**
 * Floating concept-tag pills layered on top of a canvas tile.
 *
 * Layout: every concept — both local AND global — is rendered as a pill
 * positioned ON the image. Local-scope concepts use the VLM-emitted
 * anchor (a point on the visual instance). Global-scope concepts have
 * no inherent location, so we auto-distribute them along a band at the
 * TOP of the image (interleaved across the width) — they remain
 * visually attached to the image without competing with anchored
 * local pills.
 *
 * Each pill is a direct child of the canvas `.world` div so it pans/
 * zooms WITH the image. The pill's own transform applies scale(1/zoom)
 * so on-screen size stays constant. z-index is set high enough that a
 * tile raised to the top of the stacking order does not occlude the
 * pills.
 *
 * LOD: when the tile's on-screen short side falls below 60px, every
 * pill collapses into a single "📍N" badge in the top-right corner.
 * Clicking that badge opens the legacy list popover.
 */

const LOD_PIXEL_THRESHOLD = 60;

function signFromEvent(e: React.MouseEvent): Sign {
  return e.metaKey || e.ctrlKey ? "-" : "+";
}

interface Props {
  item: CanvasItem;
  asset: Asset;
  zoom: number;
  onOpenList(assetId: string): void;
}

/**
 * Place every tag at a final (x, y) in image-normalized coordinates.
 * - local: use the VLM's anchor verbatim
 * - global: distribute along y = 0.06 across the image's width
 *
 * Order is preserved so the user sees a stable layout even if the
 * upstream order shifts slightly between recomputations.
 */
function resolveAnchors(tags: ConceptTag[]): { tag: ConceptTag; x: number; y: number; isLocal: boolean }[] {
  const out: { tag: ConceptTag; x: number; y: number; isLocal: boolean }[] = [];
  const globals = tags.filter((t) => t.scope === "global");
  let gi = 0;
  // Globals: distribute evenly across the top of the image at y=0.06.
  // n=1 → x=0.5; n=2 → x=0.28, 0.72; n=3 → x=0.18, 0.5, 0.82; etc.
  // Keep margins from edges (left edge ≥ 0.1, right edge ≤ 0.9) so pills
  // don't get clipped by the tile's rounded corners.
  function globalX(): number {
    const n = globals.length;
    const i = gi++;
    if (n === 1) return 0.5;
    return 0.1 + (i * 0.8) / (n - 1);
  }
  for (const t of tags) {
    if (t.scope === "global") {
      out.push({ tag: t, x: globalX(), y: 0.06, isLocal: false });
    } else {
      const a = t.anchor ?? [0.5, 0.5];
      out.push({ tag: t, x: a[0], y: a[1], isLocal: true });
    }
  }
  return out;
}

export function CanvasTagOverlay({ item, asset, zoom, onOpenList }: Props) {
  const tags = asset.tags?.tags ?? [];
  const toggleTag = useCurator((s) => s.toggleTag);
  const tagState = useCurator((s) => s.tagState);
  // re-render on stack changes so pills reflect +/- selection
  useCurator((s) => s.stack);

  if (tags.length === 0) return null;

  const invScale = 1 / Math.max(0.001, zoom);
  const left = item.x;
  const top = item.y;
  const W = item.width;
  const H = item.height;

  // On-screen short edge of the tile drives LOD.
  const onScreenShort = Math.min(W, H) * zoom;
  if (onScreenShort < LOD_PIXEL_THRESHOLD) {
    return (
      <div
        className={styles.lod}
        style={{
          left: left + W - 6,
          top: top + 6,
          transform: `translate(-100%, 0) scale(${invScale})`,
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onOpenList(asset.id);
        }}
        title={`${tags.length} concept${tags.length === 1 ? "" : "s"} — click to view list`}
      >
        📍 {tags.length}
      </div>
    );
  }

  const placed = resolveAnchors(tags);

  return (
    <>
      {placed.map(({ tag, x, y, isLocal }) => {
        const wx = left + x * W;
        const wy = top + y * H;
        const state = tagState(asset.id, tag.concept);
        const accent = accentForConcept(tag.concept);
        const cls = [
          styles.pill,
          state === "+" ? styles.pillPlus : "",
          state === "-" ? styles.pillMinus : "",
        ]
          .filter(Boolean)
          .join(" ");
        const title =
          isLocal
            ? `${tag.concept} — click to like, ⌘/Ctrl-click to dislike`
            : `${tag.concept} (global) — click to like, ⌘/Ctrl-click to dislike`;
        return (
          <span key={tag.concept}>
            {isLocal && (
              <span
                className={styles.dot}
                style={
                  {
                    left: wx,
                    top: wy,
                    transform: `translate(-50%, -50%) scale(${invScale})`,
                    ["--accent" as string]: accent,
                  } as React.CSSProperties
                }
              />
            )}
            <button
              className={cls}
              style={
                {
                  left: wx,
                  top: wy,
                  // Local pills sit slightly below their anchor dot so
                  // the dot stays visible; global pills center on (x,y).
                  transform: isLocal
                    ? `translate(-50%, calc(-50% + 14px)) scale(${invScale})`
                    : `translate(-50%, -50%) scale(${invScale})`,
                  ["--accent" as string]: accent,
                } as React.CSSProperties
              }
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                toggleTag(asset.id, tag.concept, signFromEvent(e));
              }}
              title={title}
            >
              {state === "+" && <span>✓</span>}
              {state === "-" && <span>✕</span>}
              <span>{tag.concept}</span>
            </button>
          </span>
        );
      })}
    </>
  );
}

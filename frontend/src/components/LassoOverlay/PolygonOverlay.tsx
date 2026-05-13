"use client";

/**
 * Persistent dashed-polygon overlay rendered inside `.world` (so it pans/zooms
 * with the canvas) for every LassoAsset whose parent is `parentItem.assetId`.
 *
 * - Polygon vertices are image-pixel coordinates → converted to world coords
 *   using the parent tile's (x, y, width, height) and the parent asset's
 *   originalW/originalH (captured by tile <img onLoad>).
 * - Stroke width and dash array are inverse-scaled by 1/zoom so the dashed
 *   line stays visually constant regardless of canvas zoom.
 * - Clicking the polygon re-opens SmartTagPopover for the lasso asset.
 */

import { useCurator } from "@/store/useCurator";
import type { Asset, CanvasItem, LassoAsset } from "@/types";

interface Props {
  parentItem: CanvasItem;
  parentAsset: Asset;
  zoom: number;
  onClick(lassoAssetId: string): void;
}

export function PolygonOverlay({ parentItem, parentAsset, zoom, onClick }: Props) {
  const assets = useCurator((s) => s.assets);

  // Find all lasso children of this tile. Cheap: assets map is small.
  const children: LassoAsset[] = [];
  for (const id of Object.keys(assets)) {
    const a = assets[id];
    if (a.origin === "lasso" && a.parentAssetId === parentAsset.id) {
      children.push(a);
    }
  }
  if (children.length === 0) return null;

  const W = parentAsset.originalW;
  const H = parentAsset.originalH;
  if (!W || !H) return null; // wait for <img onLoad>

  const invZoom = 1 / zoom;
  const strokeW = Math.max(0.5, 1.5 * invZoom);
  const dash = `${6 * invZoom} ${4 * invZoom}`;

  return (
    <>
      {children.map((child) => {
        const pts = child.polygon
          .map(([x, y]) => {
            const wx = parentItem.x + (x / W) * parentItem.width;
            const wy = parentItem.y + (y / H) * parentItem.height;
            return `${wx},${wy}`;
          })
          .join(" ");

        // centroid for callout label
        const n = child.polygon.length;
        let cx = 0;
        let cy = 0;
        for (const [x, y] of child.polygon) {
          cx += parentItem.x + (x / W) * parentItem.width;
          cy += parentItem.y + (y / H) * parentItem.height;
        }
        cx /= n;
        cy /= n;

        return (
          <svg
            key={child.id}
            style={{
              position: "absolute",
              left: parentItem.x,
              top: parentItem.y,
              width: parentItem.width,
              height: parentItem.height,
              overflow: "visible",
              pointerEvents: "none",
              zIndex: parentItem.z + 1,
            }}
            viewBox={`${parentItem.x} ${parentItem.y} ${parentItem.width} ${parentItem.height}`}
          >
            <polygon
              points={pts}
              fill="rgba(245, 164, 93, 0.10)"
              stroke="#f5a45d"
              strokeWidth={strokeW}
              strokeDasharray={dash}
              strokeLinejoin="round"
              style={{ pointerEvents: "auto", cursor: "pointer" }}
              onClick={(e) => {
                e.stopPropagation();
                onClick(child.id);
              }}
            >
              <title>{child.label || "lasso"}</title>
            </polygon>
            {/* callout label */}
            <g
              transform={`translate(${cx} ${cy}) scale(${invZoom})`}
              style={{ pointerEvents: "auto", cursor: "pointer" }}
              onClick={(e) => {
                e.stopPropagation();
                onClick(child.id);
              }}
            >
              <rect
                x={-18}
                y={-10}
                width={36}
                height={18}
                rx={4}
                fill="rgba(13,13,18,0.92)"
                stroke="#f5a45d"
                strokeWidth={1}
              />
              <text
                x={0}
                y={3}
                fontSize={11}
                fontWeight={700}
                fill="#f5a45d"
                textAnchor="middle"
                style={{ userSelect: "none" }}
              >
                {child.label || "L?"}
              </text>
            </g>
          </svg>
        );
      })}
    </>
  );
}

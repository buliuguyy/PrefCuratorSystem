"use client";

import { useState } from "react";

import { useCurator } from "@/store/useCurator";
import { SamplesSelector } from "@/components/SamplesSelector/SamplesSelector";
import { DIMENSION_COLOR, type Dimension } from "@/types";

import styles from "./FusionStackPreview.module.css";

function accentFor(dim: string): string {
  return (DIMENSION_COLOR as Record<string, string>)[dim] ?? "#9aa0a6";
}

export function FusionStackPreview() {
  const stack = useCurator((s) => s.stack);
  const removeConcept = useCurator((s) => s.removeConcept);
  const reorderConcept = useCurator((s) => s.reorderConcept);
  const clearStack = useCurator((s) => s.clearStack);
  const assets = useCurator((s) => s.assets);

  const compose = useCurator((s) => s.compose);
  const isComposing = useCurator((s) => s.isComposing);
  const composeError = useCurator((s) => s.composeError);
  const resultAssetIds = useCurator((s) => s.resultAssetIds);
  const view = useCurator((s) => s.view);
  const setView = useCurator((s) => s.setView);

  const plusCount = stack.filter((c) => c.sign === "+").length;
  const minusCount = stack.filter((c) => c.sign === "-").length;
  const canCompose = stack.length > 0 && !isComposing;
  const hasResult = resultAssetIds.length > 0;
  const showSamplesHere = view === "canvas";

  // Index of the FIRST positive concept — its asset becomes base_asset_id.
  const firstPositiveIdx = stack.findIndex((c) => c.sign === "+");

  // drag-to-reorder local state
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  return (
    <aside className={styles.panel}>
      <header className={styles.head}>
        <div className={styles.headTop}>
          <div className={styles.title}>Feature Fusion Stack</div>
          {stack.length > 0 && (
            <button className={styles.clearBtn} onClick={clearStack}>
              clear
            </button>
          )}
        </div>
        <div className={styles.subtitle}>
          {stack.length === 0
            ? "no features selected yet"
            : `${plusCount} liked · ${minusCount} disliked`}
        </div>
        {stack.length >= 2 && (
          <div className={styles.reorderHint}>
            drag to reorder · first <span className={styles.likeSpan}>+</span>{" "}
            item&apos;s image is the base
          </div>
        )}

        <div className={styles.composeRow}>
          <button
            className={styles.composeBtn}
            onClick={() => compose()}
            disabled={!canCompose}
          >
            {isComposing ? (
              <>
                <span className={styles.spinner} />
                Composing…
              </>
            ) : (
              <>
                <span className={styles.composeIcon}>✦</span>
                Compose
              </>
            )}
          </button>
          {showSamplesHere && <SamplesSelector disabled={isComposing} />}
        </div>
        {composeError && (
          <div className={styles.errorBanner}>{composeError}</div>
        )}
        {hasResult && view === "canvas" && (
          <button
            className={styles.viewResultBtn}
            onClick={() => setView("refiner")}
          >
            view last result →
          </button>
        )}
      </header>

      <div className={styles.list}>
        {stack.length === 0 && (
          <div className={styles.empty}>
            <p>Click any tile on the Canvas to open the Smart Tagging panel.</p>
            <p className={styles.emptySub}>
              Click a tag pill to <span className={styles.likeSpan}>like</span> it.
              <br />
              ⌘/Ctrl-click to <span className={styles.dislikeSpan}>dislike</span>.
            </p>
          </div>
        )}

        {stack.map((c, idx) => {
          const accent = accentFor(c.dimension as Dimension | string);
          const asset = assets[c.assetId];
          const label = asset?.label ?? "?";
          const isComposed = asset?.origin === "composed";
          const isLasso = asset?.origin === "lasso";
          const isBase = idx === firstPositiveIdx;
          const isDragging = dragIdx === idx;
          const isHover = hoverIdx === idx && dragIdx !== null && dragIdx !== idx;
          return (
            <div
              key={c.key}
              className={[
                styles.item,
                c.sign === "+" ? styles.itemPlus : styles.itemMinus,
                isDragging ? styles.itemDragging : "",
                isHover ? styles.itemDropTarget : "",
              ]
                .filter(Boolean)
                .join(" ")}
              draggable
              onDragStart={(e) => {
                setDragIdx(idx);
                e.dataTransfer.effectAllowed = "move";
                // Firefox needs setData to actually start a drag
                try {
                  e.dataTransfer.setData("text/plain", String(idx));
                } catch {
                  /* some browsers throw on setData in dragstart */
                }
              }}
              onDragOver={(e) => {
                if (dragIdx === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (hoverIdx !== idx) setHoverIdx(idx);
              }}
              onDragLeave={() => {
                if (hoverIdx === idx) setHoverIdx(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIdx !== null && dragIdx !== idx) {
                  reorderConcept(dragIdx, idx);
                }
                setDragIdx(null);
                setHoverIdx(null);
              }}
              onDragEnd={() => {
                setDragIdx(null);
                setHoverIdx(null);
              }}
            >
              <span
                className={styles.dragHandle}
                title="drag to reorder"
                aria-hidden
              >
                ⋮⋮
              </span>
              <img
                src={asset?.url ?? ""}
                alt={`asset ${label}`}
                className={styles.thumb}
              />
              <div className={styles.itemBody}>
                <div className={styles.itemTopRow}>
                  <span
                    className={styles.dimChip}
                    style={{ background: accent }}
                  >
                    {c.dimension}
                  </span>
                  <span className={styles.assetLabel}>
                    {isComposed && <span className={styles.composedMark}>✦</span>}
                    {isLasso && <span className={styles.composedMark}>✂</span>}
                    {label}
                  </span>
                  {isBase && (
                    <span
                      className={styles.baseBadge}
                      title="this concept's asset is the IP-Composer base image"
                    >
                      BASE
                    </span>
                  )}
                  <span
                    className={`${styles.signBadge} ${
                      c.sign === "+" ? styles.signPlus : styles.signMinus
                    }`}
                  >
                    {c.sign === "+" ? "+" : "−"}
                  </span>
                </div>
                <div className={styles.tags}>{c.tag}</div>
              </div>
              <button
                className={styles.removeBtn}
                onClick={() => removeConcept(c.key)}
                aria-label="remove"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

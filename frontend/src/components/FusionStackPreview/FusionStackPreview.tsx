"use client";

import { useCurator } from "@/store/useCurator";
import { SamplesSelector } from "@/components/SamplesSelector/SamplesSelector";
import { DIMENSION_COLOR } from "@/types";

import styles from "./FusionStackPreview.module.css";

export function FusionStackPreview() {
  const stack = useCurator((s) => s.stack);
  const removeConcept = useCurator((s) => s.removeConcept);
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

        {stack.map((c) => {
          const accent = DIMENSION_COLOR[c.dimension];
          const asset = assets[c.assetId];
          const label = asset?.label ?? "?";
          const isComposed = asset?.origin === "composed";
          return (
            <div
              key={c.key}
              className={`${styles.item} ${
                c.sign === "+" ? styles.itemPlus : styles.itemMinus
              }`}
            >
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
                    {label}
                  </span>
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

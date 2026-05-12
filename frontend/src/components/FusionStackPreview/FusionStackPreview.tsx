"use client";

import { api } from "@/lib/api";
import { useCurator } from "@/store/useCurator";
import { DIMENSION_COLOR } from "@/types";

import styles from "./FusionStackPreview.module.css";

export function FusionStackPreview() {
  const stack = useCurator((s) => s.stack);
  const removeConcept = useCurator((s) => s.removeConcept);
  const clearStack = useCurator((s) => s.clearStack);
  const candidates = useCurator((s) => s.candidates);

  const plusCount = stack.filter((c) => c.sign === "+").length;
  const minusCount = stack.filter((c) => c.sign === "-").length;

  return (
    <aside className={styles.panel}>
      <header className={styles.head}>
        <div>
          <div className={styles.title}>Feature Fusion Stack</div>
          <div className={styles.subtitle}>
            {stack.length === 0
              ? "no features selected yet"
              : `${plusCount} liked · ${minusCount} disliked`}
          </div>
        </div>
        {stack.length > 0 && (
          <button className={styles.clearBtn} onClick={clearStack}>
            clear
          </button>
        )}
      </header>

      <div className={styles.list}>
        {stack.length === 0 && (
          <div className={styles.empty}>
            <p>Click any candidate image to open the Smart Tagging panel.</p>
            <p className={styles.emptySub}>
              Click a tag pill to <span className={styles.likeSpan}>like</span> it.
              <br />
              ⌘/Ctrl-click to <span className={styles.dislikeSpan}>dislike</span>.
            </p>
          </div>
        )}

        {stack.map((c) => {
          const accent = DIMENSION_COLOR[c.dimension];
          const idx = candidates.findIndex((a) => a.id === c.assetId);
          const label = idx >= 0 ? String.fromCharCode(65 + idx) : "?";
          return (
            <div
              key={c.key}
              className={`${styles.item} ${
                c.sign === "+" ? styles.itemPlus : styles.itemMinus
              }`}
            >
              <img
                src={api.assetUrl(c.assetId)}
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
                    Image_{label}
                  </span>
                  <span
                    className={`${styles.signBadge} ${
                      c.sign === "+" ? styles.signPlus : styles.signMinus
                    }`}
                  >
                    {c.sign === "+" ? "+" : "−"}
                  </span>
                </div>
                <div className={styles.tags}>{c.tags.join(", ")}</div>
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

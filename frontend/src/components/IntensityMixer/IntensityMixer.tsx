"use client";

import { useState, useEffect } from "react";

import { useCurator } from "@/store/useCurator";
import { SamplesSelector } from "@/components/SamplesSelector/SamplesSelector";
import { accentForConcept } from "@/types";

import styles from "./IntensityMixer.module.css";

/**
 * Bottom panel that appears after the first Compose. One slider per
 * curated concept in the Fusion Stack. Drag → mutate the concept's alpha;
 * recompose only happens when the designer clicks the explicit "Recompose"
 * button (no auto-recompose to avoid surprising re-runs).
 */
export function IntensityMixer() {
  const stack = useCurator((s) => s.stack);
  const assets = useCurator((s) => s.assets);
  const updateAlpha = useCurator((s) => s.updateAlpha);
  const compose = useCurator((s) => s.compose);
  const isComposing = useCurator((s) => s.isComposing);
  const resultAssetIds = useCurator((s) => s.resultAssetIds);

  // Track the alphas at the moment of the last successful compose, so we can
  // tell when sliders have moved since.
  const [composedAlphas, setComposedAlphas] = useState<Record<string, number>>({});
  useEffect(() => {
    if (resultAssetIds.length > 0) {
      const snap: Record<string, number> = {};
      for (const c of stack) snap[c.key] = c.alpha;
      setComposedAlphas(snap);
    }
    // Only sync after a fresh compose result lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultAssetIds]);

  const dirty = stack.some((c) => {
    const ref = composedAlphas[c.key];
    return ref !== undefined && Math.abs(ref - c.alpha) > 1e-4;
  });

  if (stack.length === 0) {
    return (
      <div className={styles.empty}>
        Compose a result first — sliders appear here per concept in the stack.
      </div>
    );
  }

  return (
    <section className={styles.wrap}>
      <header className={styles.head}>
        <span className={styles.title}>Feature Intensity Mixer</span>
        <span className={styles.subtitle}>
          drag to weight each slot · click <em>Recompose</em> to apply
        </span>
        <SamplesSelector disabled={isComposing} />
        <button
          className={`${styles.recomposeBtn} ${dirty ? styles.recomposeDirty : ""}`}
          onClick={() => compose()}
          disabled={isComposing}
          title={dirty ? "Sliders changed — click to recompose" : "Recompose with current alphas"}
        >
          {isComposing ? (
            <>
              <span className={styles.spinner} /> Recomposing…
            </>
          ) : (
            <>
              {dirty && <span className={styles.dirtyDot} />}
              Recompose
            </>
          )}
        </button>
      </header>

      <ul className={styles.sliderList}>
        {stack.map((c) => {
          const accent = accentForConcept(c.dimension);
          // Phase 9: dimension == tag (both = concept name). Render just
          // the concept chip; the trailing summary is a no-op when they
          // match, kept around in case a legacy persona record splits
          // them.
          const showSummary = c.tag && c.tag !== c.dimension;
          return (
            <li key={c.key} className={styles.row}>
              <div className={styles.label}>
                <span
                  className={styles.dimChip}
                  style={{ background: accent }}
                >
                  {c.dimension}
                </span>
                {showSummary && <span className={styles.summary}>{c.tag}</span>}
                <span
                  className={`${styles.signTag} ${
                    c.sign === "+" ? styles.signPlus : styles.signMinus
                  }`}
                >
                  {c.sign === "+" ? "+" : "−"}
                </span>
              </div>

              <div className={styles.sliderRow}>
                <img
                  src={assets[c.assetId]?.url ?? ""}
                  alt=""
                  className={styles.thumb}
                />
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={c.alpha}
                  onChange={(e) => updateAlpha(c.key, parseFloat(e.target.value))}
                  className={styles.slider}
                  style={
                    {
                      "--accent": accent,
                      "--fill": `${c.alpha * 100}%`,
                    } as React.CSSProperties
                  }
                />
                <span className={styles.alphaVal}>{c.alpha.toFixed(2)}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

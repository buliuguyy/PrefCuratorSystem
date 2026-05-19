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
 *
 * Persona-save entry point lives in the header (next to Recompose) — the
 * Intensity Mixer is the natural moment to capture a "this iteration is
 * keeper-shaped" snapshot, so the save button sits where the user already
 * is when that thought hits.
 */
export function IntensityMixer() {
  const stack = useCurator((s) => s.stack);
  const assets = useCurator((s) => s.assets);
  const updateAlpha = useCurator((s) => s.updateAlpha);
  const compose = useCurator((s) => s.compose);
  const isComposing = useCurator((s) => s.isComposing);
  const resultAssetIds = useCurator((s) => s.resultAssetIds);
  const currentUserId = useCurator((s) => s.currentUserId);
  const activePersonaId = useCurator((s) => s.activePersonaId);
  const saveCurrentAsPersona = useCurator((s) => s.saveCurrentAsPersona);
  const updatePersonaFromCurrent = useCurator(
    (s) => s.updatePersonaFromCurrent,
  );

  const [savingMode, setSavingMode] = useState<"closed" | "open">("closed");
  const [personaName, setPersonaName] = useState("");
  const [savePending, setSavePending] = useState(false);

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

  const canSavePersona = !!currentUserId && stack.length > 0;

  async function commitNewPersona() {
    const nm = personaName.trim();
    if (!nm) return;
    setSavePending(true);
    try {
      const created = await saveCurrentAsPersona(nm);
      if (created) {
        setPersonaName("");
        setSavingMode("closed");
      }
    } finally {
      setSavePending(false);
    }
  }

  async function updateActivePersona() {
    if (!activePersonaId) return;
    setSavePending(true);
    try {
      await updatePersonaFromCurrent(activePersonaId);
    } finally {
      setSavePending(false);
    }
  }

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
          drag to weight each slot · 1.0 = neutral · &gt;1.0 over-amplifies · click <em>Recompose</em> to apply
        </span>
        <SamplesSelector disabled={isComposing} />
        {savingMode === "open" ? (
          <div className={styles.savePersonaRow}>
            <input
              className={styles.savePersonaInput}
              placeholder="persona name"
              value={personaName}
              onChange={(e) => setPersonaName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void commitNewPersona();
                if (e.key === "Escape") {
                  setSavingMode("closed");
                  setPersonaName("");
                }
              }}
              maxLength={60}
              autoFocus
              disabled={savePending}
            />
            <button
              className={styles.savePersonaOk}
              disabled={!personaName.trim() || savePending || !canSavePersona}
              onClick={commitNewPersona}
              title="Save the current stack as a new persona"
            >
              {savePending ? "…" : "Save"}
            </button>
            <button
              className={styles.savePersonaCancel}
              onClick={() => {
                setSavingMode("closed");
                setPersonaName("");
              }}
              title="Cancel"
            >
              ✕
            </button>
          </div>
        ) : (
          <>
            {activePersonaId && (
              <button
                className={styles.personaUpdateBtn}
                onClick={updateActivePersona}
                disabled={savePending || !canSavePersona}
                title="Overwrite the active persona with the current stack"
              >
                {savePending ? "…" : "Update persona"}
              </button>
            )}
            <button
              className={styles.personaSaveBtn}
              onClick={() => setSavingMode("open")}
              disabled={!canSavePersona}
              title={
                canSavePersona
                  ? "Snapshot the current stack as a new persona"
                  : currentUserId
                  ? "Pick at least one tag first"
                  : "Sign in (top-right) to save personas"
              }
            >
              + Save persona
            </button>
          </>
        )}
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
                <div className={styles.sliderWrap}>
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.05}
                    value={c.alpha}
                    onChange={(e) =>
                      updateAlpha(c.key, parseFloat(e.target.value))
                    }
                    className={styles.slider}
                    title={
                      c.alpha > 1
                        ? `α=${c.alpha.toFixed(2)} (exploratory — over-amplified)`
                        : `α=${c.alpha.toFixed(2)}`
                    }
                    style={
                      {
                        "--accent": accent,
                        "--fill": `${(c.alpha / 2) * 100}%`,
                      } as React.CSSProperties
                    }
                  />
                  <span className={styles.tickNeutral} aria-hidden />
                </div>
                <span
                  className={`${styles.alphaVal} ${
                    c.alpha > 1 ? styles.alphaHot : ""
                  }`}
                  title={c.alpha > 1 ? "above 1.0 over-amplifies this slot" : undefined}
                >
                  {c.alpha.toFixed(2)}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

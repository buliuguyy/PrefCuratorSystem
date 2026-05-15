"use client";

import { useCurator } from "@/store/useCurator";
import { IntensityMixer } from "@/components/IntensityMixer/IntensityMixer";

import styles from "./Refiner.module.css";

/**
 * Renamed from ResultCanvas — the focused inspector for one composition
 * (or its 1–N variants). The canvas word is reserved for the freeform main
 * workspace; this view is a refinement stage.
 *
 * Reads URL directly from `assets[id].url` instead of `api.assetUrl(id)` so
 * data: URLs (mock composites) and real backend URLs both work uniformly.
 */
export function Refiner() {
  const assets = useCurator((s) => s.assets);
  const resultAssetIds = useCurator((s) => s.resultAssetIds);
  const selectedResultIdx = useCurator((s) => s.selectedResultIdx);
  const setSelectedResultIdx = useCurator((s) => s.setSelectedResultIdx);
  const resultUsedMock = useCurator((s) => s.resultUsedMock);
  const resultDrift = useCurator((s) => s.resultDrift);
  const resultDriftWarn = useCurator((s) => s.resultDriftWarn);
  const isComposing = useCurator((s) => s.isComposing);
  const setView = useCurator((s) => s.setView);
  const numSamples = useCurator((s) => s.numSamples);

  if (resultAssetIds.length === 0) return null;
  const safeIdx = Math.min(selectedResultIdx, resultAssetIds.length - 1);
  const activeAsset = assets[resultAssetIds[safeIdx]];

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <button
          className={styles.backBtn}
          onClick={() => setView("canvas")}
          title="Back to the Canvas"
        >
          ← Back to Canvas
        </button>
        <div className={styles.title}>
          Refiner
          {resultAssetIds.length > 1 && (
            <span className={styles.countChip}>
              {safeIdx + 1} / {resultAssetIds.length}
            </span>
          )}
        </div>
        <div className={styles.headRightSpacer} />
      </header>

      {resultUsedMock && (
        <div className={styles.mockBanner}>
          <span className={styles.mockDot} />
          <span>
            <strong>Mock fallback</strong> — IP-Composer unreachable or errored
            (commonly: free-form concept tag triggered an LLM auto-gen failure
            on the IP-Composer side, or the service isn&apos;t running on
            <code>localhost:12100</code>). The composite above is a frontend
            stand-in; backend log has the real error.
          </span>
        </div>
      )}

      {!resultUsedMock && resultDriftWarn && (
        <div className={styles.driftBanner}>
          <span className={styles.driftDot} />
          <span>
            <strong>High drift</strong> ({resultDrift?.toFixed(2)}) — the fused
            embedding moved far from the base image, so the output may be
            off-distribution. Try lowering some &alpha; values or removing a
            slot.
          </span>
        </div>
      )}

      <div className={styles.canvasWrap}>
        {isComposing && (
          <div className={styles.composingOverlay}>
            <span className={styles.spinner} />
            <span>composing {numSamples > 1 ? `${numSamples} variants` : "1 result"}…</span>
          </div>
        )}
        {activeAsset && (
          <img
            key={activeAsset.id}
            src={activeAsset.url}
            alt={`Composed result ${safeIdx + 1}`}
            className={styles.canvasImg}
          />
        )}
      </div>

      {resultAssetIds.length > 1 && (
        <div className={styles.thumbStrip}>
          {resultAssetIds.map((id, i) => {
            const a = assets[id];
            if (!a) return null;
            return (
              <button
                key={id}
                className={`${styles.thumbBtn} ${
                  i === safeIdx ? styles.thumbBtnActive : ""
                }`}
                onClick={() => setSelectedResultIdx(i)}
                aria-label={`Variant ${i + 1}`}
              >
                <img src={a.url} alt="" className={styles.thumbImg} />
                <span className={styles.thumbLabel}>{i + 1}</span>
              </button>
            );
          })}
        </div>
      )}

      <footer className={styles.foot}>
        <span className={styles.hint}>
          Modify the Fusion Stack on the right · drag intensity sliders below ·
          press <em>Recompose</em> to apply
        </span>
      </footer>

      <IntensityMixer />
    </div>
  );
}

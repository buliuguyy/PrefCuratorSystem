"use client";

import { useCurator } from "@/store/useCurator";

import styles from "./SamplesSelector.module.css";

interface Props {
  disabled?: boolean;
}

/**
 * Small 1/2/3/4 segmented control that binds to `useCurator.numSamples`.
 * Used both in the Feature Fusion Stack panel (pre-compose) and in the
 * Intensity Mixer header (post-compose, next to Recompose).
 */
export function SamplesSelector({ disabled = false }: Props) {
  const numSamples = useCurator((s) => s.numSamples);
  const setNumSamples = useCurator((s) => s.setNumSamples);

  return (
    <div
      className={styles.group}
      role="radiogroup"
      aria-label="number of compose samples"
    >
      <span className={styles.label}>samples</span>
      {[1, 2, 3, 4].map((n) => (
        <button
          key={n}
          role="radio"
          aria-checked={n === numSamples}
          className={`${styles.btn} ${n === numSamples ? styles.btnOn : ""}`}
          onClick={() => setNumSamples(n)}
          disabled={disabled}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

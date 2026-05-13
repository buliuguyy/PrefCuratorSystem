"use client";

import { useCurator } from "@/store/useCurator";

import styles from "./Topbar.module.css";

export function Topbar() {
  const prompt = useCurator((s) => s.prompt);
  const setPrompt = useCurator((s) => s.setPrompt);
  const generate = useCurator((s) => s.generate);
  const loading = useCurator((s) => s.loadingCandidates);
  const composeError = useCurator((s) => s.composeError);

  return (
    <header className={styles.topbar}>
      <div className={styles.brand}>
        <div className={styles.brandMark} aria-hidden />
        <span>PrefCurator</span>
      </div>

      <div className={styles.promptGroup}>
        <span className={styles.promptLabel}>Prompt</span>
        <input
          type="text"
          className={styles.promptInput}
          placeholder="Design a house ..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !loading) generate();
          }}
        />
        <button
          className={styles.generateBtn}
          onClick={() => generate()}
          disabled={loading || !prompt.trim()}
        >
          {loading ? "Generating…" : "Generate"}
        </button>
      </div>

      <div className={styles.right}>
        {composeError && <span className={styles.error}>{composeError}</span>}
        <span className={styles.phaseChip}>phase 3.7</span>
      </div>
    </header>
  );
}

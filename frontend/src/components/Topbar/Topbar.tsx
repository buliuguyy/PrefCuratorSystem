"use client";

import { useState } from "react";

import { api } from "@/lib/api";
import { useCurator } from "@/store/useCurator";

import styles from "./Topbar.module.css";

export function Topbar() {
  const prompt = useCurator((s) => s.prompt);
  const setPrompt = useCurator((s) => s.setPrompt);
  const setCandidates = useCurator((s) => s.setCandidates);
  const setLoadingCandidates = useCurator((s) => s.setLoadingCandidates);
  const loading = useCurator((s) => s.loadingCandidates);

  const [error, setError] = useState<string | null>(null);

  async function onGenerate() {
    if (!prompt.trim()) return;
    setError(null);
    setLoadingCandidates(true);
    try {
      const res = await api.generateCandidates(prompt.trim(), 4);
      setCandidates(res.candidates);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingCandidates(false);
    }
  }

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
            if (e.key === "Enter" && !loading) onGenerate();
          }}
        />
        <button
          className={styles.generateBtn}
          onClick={onGenerate}
          disabled={loading || !prompt.trim()}
        >
          {loading ? "Generating…" : "Generate"}
        </button>
      </div>

      <div className={styles.right}>
        {error && <span className={styles.error}>{error}</span>}
        <span className={styles.phaseChip}>phase 2</span>
      </div>
    </header>
  );
}

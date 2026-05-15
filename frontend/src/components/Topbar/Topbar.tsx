"use client";

import { useRef, useState } from "react";

import { useCurator } from "@/store/useCurator";

import styles from "./Topbar.module.css";

export function Topbar() {
  const prompt = useCurator((s) => s.prompt);
  const setPrompt = useCurator((s) => s.setPrompt);
  const generate = useCurator((s) => s.generate);
  const uploadAsset = useCurator((s) => s.uploadAsset);
  const loading = useCurator((s) => s.loadingCandidates);
  const composeError = useCurator((s) => s.composeError);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function onFilesChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const f of Array.from(files)) await uploadAsset(f);
    } finally {
      setUploading(false);
      // reset so re-picking the same file fires onChange again
      if (fileInputRef.current) fileInputRef.current.value = "";
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
        <button
          className={styles.uploadBtn}
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          title="Upload image(s) — treated identically to generated candidates"
        >
          {uploading ? "Uploading…" : "Upload"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className={styles.hiddenFileInput}
          onChange={onFilesChosen}
        />
      </div>

      <div className={styles.right}>
        {composeError && <span className={styles.error}>{composeError}</span>}
        <span className={styles.phaseChip}>phase 7</span>
      </div>
    </header>
  );
}

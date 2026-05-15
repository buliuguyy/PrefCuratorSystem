"use client";

import { useEffect } from "react";

import { useCurator } from "@/store/useCurator";

import styles from "./PreviewOverlay.module.css";

/**
 * Centered large-image preview triggered by a plain left-click on a canvas
 * tile. Backdrop click and Esc close it. No edit controls — preview only.
 */
export function PreviewOverlay() {
  const assetId = useCurator((s) => s.previewAssetId);
  const asset = useCurator((s) => (assetId ? s.assets[assetId] : null));
  const setPreview = useCurator((s) => s.setPreview);

  useEffect(() => {
    if (!assetId) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPreview(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [assetId, setPreview]);

  if (!assetId || !asset) return null;

  return (
    <div className={styles.backdrop} onClick={() => setPreview(null)}>
      <div className={styles.frame} onClick={(e) => e.stopPropagation()}>
        <img src={asset.url} alt={asset.label} className={styles.img} />
        <div className={styles.meta}>
          <span className={styles.label}>{asset.label}</span>
          <span className={styles.origin}>{asset.origin}</span>
        </div>
        <button
          className={styles.close}
          onClick={() => setPreview(null)}
          aria-label="close preview"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

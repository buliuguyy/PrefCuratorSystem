"use client";

import { useState } from "react";

import { api } from "@/lib/api";
import { useCurator } from "@/store/useCurator";
import type { AssetRef } from "@/types";
import { SmartTagPopover } from "@/components/SmartTagPopover/SmartTagPopover";

import styles from "./InspirationGrid.module.css";

export function InspirationGrid() {
  const candidates = useCurator((s) => s.candidates);
  const loading = useCurator((s) => s.loadingCandidates);
  const [activeAssetId, setActiveAssetId] = useState<string | null>(null);

  if (loading) {
    return (
      <div className={styles.gridWrap}>
        <div className={styles.grid}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={styles.tile} data-skeleton />
          ))}
        </div>
      </div>
    );
  }

  if (candidates.length === 0) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyMark}>✦</div>
        <p>Enter a prompt above and click <strong>Generate</strong>.</p>
        <p className={styles.emptyHint}>
          Four candidate inspiration images will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.gridWrap}>
      <div className={styles.grid}>
        {candidates.map((c, i) => (
          <CandidateTile
            key={c.id}
            asset={c}
            label={String.fromCharCode(65 + i)} // A, B, C, D
            active={activeAssetId === c.id}
            onActivate={() =>
              setActiveAssetId(activeAssetId === c.id ? null : c.id)
            }
          />
        ))}
      </div>

      {activeAssetId && (
        <SmartTagPopover
          assetId={activeAssetId}
          onClose={() => setActiveAssetId(null)}
        />
      )}
    </div>
  );
}

function CandidateTile({
  asset,
  label,
  active,
  onActivate,
}: {
  asset: AssetRef;
  label: string;
  active: boolean;
  onActivate: () => void;
}) {
  return (
    <button
      className={`${styles.tile} ${active ? styles.tileActive : ""}`}
      onClick={onActivate}
    >
      <img
        src={api.assetUrl(asset.id)}
        alt={`Candidate ${label}`}
        className={styles.tileImg}
      />
      <span className={styles.tileLabel}>Image_{label}</span>
    </button>
  );
}

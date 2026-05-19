"use client";

import { useMemo, useState } from "react";

import { useCurator } from "@/store/useCurator";
import type { Asset, AssetOrigin } from "@/types";
import {
  FinalBadge,
  finalContainerClass,
} from "@/components/FinalBadge/FinalBadge";

import styles from "./AssetLibrary.module.css";

type Filter = "all" | AssetOrigin;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "generated", label: "Gen" },
  { key: "uploaded", label: "Upload" },
  { key: "lasso", label: "Lasso" },
  { key: "composed", label: "Result" },
];

async function downloadAsset(asset: Asset): Promise<void> {
  const res = await fetch(asset.url);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const ext = (blob.type.split("/")[1] || "png").split(";")[0];
  const a = document.createElement("a");
  a.href = url;
  a.download = `${asset.label || asset.id}.${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function AssetLibrary() {
  const assets = useCurator((s) => s.assets);
  const setPreview = useCurator((s) => s.setPreview);
  const setActivePopover = useCurator((s) => s.setActivePopover);
  const startLasso = useCurator((s) => s.startLasso);
  const setFinalAsset = useCurator((s) => s.setFinalAsset);
  const finalAssetId = useCurator((s) => s.finalAssetId);

  const [filter, setFilter] = useState<Filter>("all");
  const [ctxMenu, setCtxMenu] = useState<
    { assetId: string; clientX: number; clientY: number } | null
  >(null);

  const list = useMemo(() => {
    const all = Object.values(assets);
    const filtered = filter === "all" ? all : all.filter((a) => a.origin === filter);
    filtered.sort((a, b) => b.createdAt - a.createdAt);
    return filtered;
  }, [assets, filter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0 };
    for (const a of Object.values(assets)) {
      c.all++;
      c[a.origin] = (c[a.origin] ?? 0) + 1;
    }
    return c;
  }, [assets]);

  return (
    <aside className={styles.panel}>
      <header className={styles.head}>
        <div className={styles.title}>Asset Library</div>
        <div className={styles.subtitle}>
          {list.length} / {counts.all ?? 0} visible
        </div>
      </header>

      <div className={styles.filterRow}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`${styles.filter} ${
              filter === f.key ? styles.filterActive : ""
            }`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            <span className={styles.filterCount}>{counts[f.key] ?? 0}</span>
          </button>
        ))}
      </div>

      <div
        className={styles.grid}
        onClick={() => setCtxMenu(null)}
      >
        {list.length === 0 && (
          <div className={styles.empty}>
            Empty. Generated, uploaded, lasso and composed assets show up here.
          </div>
        )}
        {list.map((a) => {
          const isFinal = a.id === finalAssetId;
          return (
            <button
              key={a.id}
              className={`${styles.cell} ${isFinal ? finalContainerClass : ""}`}
              onClick={() => setPreview(a.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setCtxMenu({
                  assetId: a.id,
                  clientX: e.clientX,
                  clientY: e.clientY,
                });
              }}
              title={`${a.label || a.id} · ${a.origin}`}
            >
              <img src={a.url} alt={a.label} className={styles.img} />
              <span className={styles.label}>
                {a.origin === "composed" ? "✦" : a.origin === "lasso" ? "✂" : a.origin === "uploaded" ? "↑" : ""}
                {a.label}
              </span>
              {isFinal && <FinalBadge />}
            </button>
          );
        })}
      </div>

      {ctxMenu && (
        <>
          <div
            className={styles.ctxBackdrop}
            onClick={() => setCtxMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtxMenu(null);
            }}
          />
          <div
            className={styles.ctxMenu}
            style={{ left: ctxMenu.clientX, top: ctxMenu.clientY }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              className={styles.ctxItem}
              onClick={() => {
                setActivePopover(ctxMenu.assetId);
                setCtxMenu(null);
              }}
            >
              <span className={styles.ctxIcon}>◎</span> Smart tag
            </button>
            <button
              className={styles.ctxItem}
              onClick={() => {
                startLasso(ctxMenu.assetId);
                setCtxMenu(null);
              }}
            >
              <span className={styles.ctxIcon}>✂</span> Lasso this image
            </button>
            <button
              className={styles.ctxItem}
              onClick={() => {
                const a = assets[ctxMenu.assetId];
                if (a) void downloadAsset(a);
                setCtxMenu(null);
              }}
            >
              <span className={styles.ctxIcon}>⬇</span> Save to local
            </button>
            <div className={styles.ctxSep} />
            <button
              className={styles.ctxItem}
              onClick={() => {
                setFinalAsset(
                  finalAssetId === ctxMenu.assetId ? null : ctxMenu.assetId,
                );
                setCtxMenu(null);
              }}
            >
              <span className={styles.ctxIcon}>★</span>
              {finalAssetId === ctxMenu.assetId
                ? "Unpin from final"
                : "Pin as final"}
            </button>
          </div>
        </>
      )}
    </aside>
  );
}

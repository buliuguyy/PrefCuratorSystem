"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { useCurator } from "@/store/useCurator";
import {
  ALL_DIMENSIONS,
  DIMENSION_COLOR,
  type Dimension,
  type Sign,
  type TagResult,
} from "@/types";

import styles from "./SmartTagPopover.module.css";

interface Props {
  assetId: string;
  onClose(): void;
}

function signFromEvent(e: React.MouseEvent): Sign {
  return e.metaKey || e.ctrlKey ? "-" : "+";
}

export function SmartTagPopover({ assetId, onClose }: Props) {
  const asset = useCurator((s) => s.assets[assetId]);
  const setAssetTags = useCurator((s) => s.setAssetTags);
  const toggleTag = useCurator((s) => s.toggleTag);
  const tagState = useCurator((s) => s.tagState);
  // re-render on stack changes so selected pill states update
  useCurator((s) => s.stack);

  const cached = asset?.tags ?? null;
  const [data, setData] = useState<TagResult | null>(cached);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cached) {
      setData(cached);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .smartTag(assetId, [...ALL_DIMENSIONS])
      .then((r) => {
        if (cancelled) return;
        setData(r);
        setAssetTags(assetId, r);
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  function onTagClick(e: React.MouseEvent, dim: Dimension, tag: string) {
    e.preventDefault();
    e.stopPropagation();
    toggleTag(assetId, dim, tag, signFromEvent(e));
  }

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.popover} onClick={(e) => e.stopPropagation()}>
        <header className={styles.head}>
          <span className={styles.title}>
            Smart Tagging
            {asset && (
              <span
                className={`${styles.assetChip} ${
                  asset.origin === "composed" ? styles.assetChipComposed : ""
                }`}
              >
                {asset.origin === "composed" ? "✦ " : ""}
                {asset.label}
              </span>
            )}
          </span>
          <span className={styles.subtitle}>
            click a tag to <em>like</em> · ⌘/Ctrl-click to <em>dislike</em>
          </span>
          <button
            className={styles.close}
            onClick={onClose}
            aria-label="close"
          >
            ✕
          </button>
        </header>

        {error && <div className={styles.error}>{error}</div>}

        {loading && (
          <div className={styles.loadingRow}>
            <span className={styles.spinner} />
            <span>extracting semantic features…</span>
          </div>
        )}

        {data && (
          <ul className={styles.dimList}>
            {ALL_DIMENSIONS.map((dim) => {
              const tags = data.tags[dim] ?? [];
              if (tags.length === 0) return null;
              const accent = DIMENSION_COLOR[dim];
              return (
                <li key={dim} className={styles.dimRow}>
                  <span
                    className={styles.dimChip}
                    style={{ background: accent }}
                  >
                    {dim}
                  </span>
                  <div className={styles.pills}>
                    {tags.map((tag) => {
                      const state = tagState(assetId, dim, tag);
                      const cls = [
                        styles.pill,
                        state === "+" ? styles.pillPlus : "",
                        state === "-" ? styles.pillMinus : "",
                      ]
                        .filter(Boolean)
                        .join(" ");
                      return (
                        <button
                          key={tag}
                          className={cls}
                          onClick={(e) => onTagClick(e, dim, tag)}
                        >
                          {state === "+" && (
                            <span className={styles.markPlus}>✓</span>
                          )}
                          {state === "-" && (
                            <span className={styles.markMinus}>✕</span>
                          )}
                          <span className={styles.pillText}>{tag}</span>
                        </button>
                      );
                    })}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <footer className={styles.foot}>
          <span className={styles.hint}>
            tap outside or press <kbd>Esc</kbd> to close
          </span>
        </footer>
      </div>
    </>
  );
}

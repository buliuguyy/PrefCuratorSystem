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

/** Accent color for a dimension. Falls back to a neutral when the dim doesn't
 *  match a known key (so the popover gracefully handles dynamic VLM dims). */
function accentFor(dim: string): string {
  return (DIMENSION_COLOR as Record<string, string>)[dim] ?? "#9aa0a6";
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
    // Minimum visible spinner time so the user gets a clear "extracting…"
    // affordance even when the backend returns near-instantly (e.g. mock
    // fallback). Without this, the popover would flash open with tags
    // already populated and feel like nothing happened.
    const MIN_SPINNER_MS = 400;
    const startedAt = Date.now();
    api
      .smartTag(assetId, [...ALL_DIMENSIONS])
      .then((r) => {
        if (cancelled) return;
        const elapsed = Date.now() - startedAt;
        const delay = Math.max(0, MIN_SPINNER_MS - elapsed);
        setTimeout(() => {
          if (cancelled) return;
          setData(r);
          setAssetTags(assetId, r);
          setLoading(false);
        }, delay);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e));
        setLoading(false);
      });
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
            {Object.entries(data.tags).map(([dim, tags]) => {
              if (!tags || tags.length === 0) return null;
              const accent = accentFor(dim);
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
                      const state = tagState(assetId, dim as Dimension, tag);
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
                          onClick={(e) =>
                            onTagClick(e, dim as Dimension, tag)
                          }
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

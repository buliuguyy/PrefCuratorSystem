"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { useCurator } from "@/store/useCurator";
import {
  ALL_DIMENSIONS,
  DIMENSION_COLOR,
  type Dimension,
  type TagResult,
} from "@/types";

import styles from "./SmartTagPopover.module.css";

interface Props {
  assetId: string;
  onClose(): void;
}

/** Decide what sign a click event represents (cmd / ctrl = negative). */
function signFromEvent(e: React.MouseEvent): "+" | "-" {
  return e.metaKey || e.ctrlKey ? "-" : "+";
}

export function SmartTagPopover({ assetId, onClose }: Props) {
  const tagCache = useCurator((s) => s.tagCache);
  const setTagsForAsset = useCurator((s) => s.setTagsForAsset);
  const stack = useCurator((s) => s.stack);
  const toggleConcept = useCurator((s) => s.toggleConcept);

  const cached = tagCache[assetId];
  const [data, setData] = useState<TagResult | null>(cached ?? null);
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
        setTagsForAsset(assetId, r);
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId]);

  // ESC to close
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  function isSelected(
    dim: Dimension,
    sign: "+" | "-",
    tags: string[],
  ): boolean {
    return stack.some(
      (c) =>
        c.assetId === assetId &&
        c.dimension === dim &&
        c.sign === sign &&
        c.tags.length === tags.length &&
        c.tags.every((t, i) => t === tags[i]),
    );
  }

  function onPillClick(
    e: React.MouseEvent,
    dim: Dimension,
    tags: string[],
  ) {
    e.preventDefault();
    e.stopPropagation();
    toggleConcept(assetId, dim, tags, signFromEvent(e));
  }

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.popover} onClick={(e) => e.stopPropagation()}>
        <header className={styles.head}>
          <span className={styles.title}>Smart Tagging</span>
          <span className={styles.subtitle}>
            click to <em>like</em> · ⌘/Ctrl+click to <em>dislike</em>
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
              const selPlus = isSelected(dim, "+", tags);
              const selMinus = isSelected(dim, "-", tags);
              return (
                <li key={dim} className={styles.dimRow}>
                  <span
                    className={styles.dimChip}
                    style={{ background: accent }}
                  >
                    {dim}
                  </span>
                  <button
                    className={[
                      styles.pill,
                      selPlus ? styles.pillPlus : "",
                      selMinus ? styles.pillMinus : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    style={
                      selPlus
                        ? ({
                            "--accent": accent,
                          } as React.CSSProperties)
                        : undefined
                    }
                    onClick={(e) => onPillClick(e, dim, tags)}
                  >
                    {selPlus && <span className={styles.markPlus}>✓</span>}
                    {selMinus && <span className={styles.markMinus}>✕</span>}
                    <span className={styles.pillText}>{tags.join(", ")}</span>
                  </button>
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

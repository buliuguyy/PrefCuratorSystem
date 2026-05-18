"use client";

import { useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import { useCurator } from "@/store/useCurator";
import { accentForConcept, type Sign, type TagResult } from "@/types";

import styles from "./SmartTagPopover.module.css";

/**
 * Phase 9 fallback list view of the smart-tag concepts. The primary UX is
 * the floating CanvasTagOverlay; this popover stays around as a debug /
 * keyboard-accessible alternative (opened by right-click → "Smart tag as
 * list"). Same data, simpler layout.
 */

interface Props {
  assetId: string;
  onClose(): void;
}

const DEFAULT_RIGHT = 24;
const DEFAULT_TOP = 96;
const POPOVER_WIDTH = 380;

function signFromEvent(e: React.MouseEvent): Sign {
  return e.metaKey || e.ctrlKey ? "-" : "+";
}

export function SmartTagPopover({ assetId, onClose }: Props) {
  const asset = useCurator((s) => s.assets[assetId]);
  const setAssetTags = useCurator((s) => s.setAssetTags);
  const setTagging = useCurator((s) => s.setTagging);
  const isPreTagging = useCurator((s) => !!s.taggingAssets[assetId]);
  const toggleTag = useCurator((s) => s.toggleTag);
  const tagState = useCurator((s) => s.tagState);
  // re-render on stack changes so selected pill states update
  useCurator((s) => s.stack);

  const data: TagResult | null = asset?.tags ?? null;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (data) return;
    if (isPreTagging) return;
    const controller = new AbortController();
    setTagging(assetId, true);
    api
      .smartTag(assetId, controller.signal)
      .then((r) => {
        if (controller.signal.aborted) return;
        const cur = useCurator.getState().assets[assetId];
        if (cur && !cur.tags) setAssetTags(assetId, r);
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        if (e && typeof e === "object" && (e as { name?: string }).name === "AbortError") {
          return;
        }
        setError(String(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setTagging(assetId, false);
      });
    return () => {
      controller.abort();
      setTagging(assetId, false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId, isPreTagging]);

  const loading = !data && (isPreTagging || !error);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  function onTagClick(e: React.MouseEvent, concept: string) {
    e.preventDefault();
    e.stopPropagation();
    toggleTag(assetId, concept, signFromEvent(e));
  }

  // ─── drag state: header is a handle for repositioning ────────────────────
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origLeft: number;
    origTop: number;
  } | null>(null);

  function onHeaderPointerDown(e: React.PointerEvent<HTMLElement>) {
    if ((e.target as HTMLElement).closest(`.${styles.close}`)) return;
    e.preventDefault();
    const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origLeft: rect.left,
      origTop: rect.top,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onHeaderPointerMove(e: React.PointerEvent<HTMLElement>) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    const maxLeft = Math.max(0, window.innerWidth - POPOVER_WIDTH);
    const left = Math.max(0, Math.min(maxLeft, d.origLeft + dx));
    const top = Math.max(0, Math.min(window.innerHeight - 80, d.origTop + dy));
    setPos({ left, top });
  }
  function onHeaderPointerUp(e: React.PointerEvent<HTMLElement>) {
    dragRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* not captured */
    }
  }

  const popoverStyle: React.CSSProperties = pos
    ? { left: pos.left, top: pos.top, right: "auto" }
    : { right: DEFAULT_RIGHT, top: DEFAULT_TOP };

  const tags = data?.tags ?? [];
  const locals = tags.filter((t) => t.scope === "local");
  const globals = tags.filter((t) => t.scope === "global");

  return (
    <div
      className={styles.popover}
      style={popoverStyle}
      onClick={(e) => e.stopPropagation()}
    >
      <header
        className={styles.head}
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
      >
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
          click a concept to <em>like</em> · ⌘/Ctrl-click to <em>dislike</em>
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
          <span>extracting concepts…</span>
        </div>
      )}

      {data && (
        <div className={styles.dimList}>
          {locals.length > 0 && (
            <div className={styles.dimRow}>
              <span className={styles.dimChip} style={{ background: "#3a3a45" }}>
                Local
              </span>
              <div className={styles.pills}>
                {locals.map((t) => {
                  const state = tagState(assetId, t.concept);
                  const accent = accentForConcept(t.concept);
                  const cls = [
                    styles.pill,
                    state === "+" ? styles.pillPlus : "",
                    state === "-" ? styles.pillMinus : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <button
                      key={t.concept}
                      className={cls}
                      onClick={(e) => onTagClick(e, t.concept)}
                      style={
                        state === null
                          ? { borderColor: accent, color: accent }
                          : undefined
                      }
                    >
                      {state === "+" && <span className={styles.markPlus}>✓</span>}
                      {state === "-" && <span className={styles.markMinus}>✕</span>}
                      <span className={styles.pillText}>{t.concept}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {globals.length > 0 && (
            <div className={styles.dimRow}>
              <span className={styles.dimChip} style={{ background: "#3a3a45" }}>
                Global
              </span>
              <div className={styles.pills}>
                {globals.map((t) => {
                  const state = tagState(assetId, t.concept);
                  const accent = accentForConcept(t.concept);
                  const cls = [
                    styles.pill,
                    state === "+" ? styles.pillPlus : "",
                    state === "-" ? styles.pillMinus : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <button
                      key={t.concept}
                      className={cls}
                      onClick={(e) => onTagClick(e, t.concept)}
                      style={
                        state === null
                          ? { borderColor: accent, color: accent }
                          : undefined
                      }
                    >
                      {state === "+" && <span className={styles.markPlus}>✓</span>}
                      {state === "-" && <span className={styles.markMinus}>✕</span>}
                      <span className={styles.pillText}>{t.concept}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <footer className={styles.foot}>
        <span className={styles.hint}>
          drag header to move · press <kbd>Esc</kbd> to close · canvas
          stays interactive
        </span>
      </footer>
    </div>
  );
}

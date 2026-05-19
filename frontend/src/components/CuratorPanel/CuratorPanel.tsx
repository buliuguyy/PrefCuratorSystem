"use client";

import { useState } from "react";

import { useCurator } from "@/store/useCurator";

import styles from "./CuratorPanel.module.css";

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

/** Curator Panel: chronological Version History of every compose run in
 *  this session. Phase 10 removed the dedicated Final Composition slot —
 *  the FINAL marker now lives purely as a yellow badge on the pinned
 *  tile / cell wherever it appears (Canvas, Asset Library). */
export function CuratorPanel() {
  const gallery = useCurator((s) => s.gallery);
  const activeId = useCurator((s) => s.activeGalleryId);
  const loadEntry = useCurator((s) => s.loadGalleryEntry);
  const removeEntry = useCurator((s) => s.removeGalleryEntry);
  const assets = useCurator((s) => s.assets);
  const setFinalAsset = useCurator((s) => s.setFinalAsset);

  const [ctx, setCtx] = useState<
    { kind: "gallery" | "asset"; id: string; x: number; y: number } | null
  >(null);

  return (
    <aside className={styles.panel}>
      <section className={styles.section}>
        <header className={styles.head}>
          <div className={styles.title}>The Curator Panel</div>
          <div className={styles.subtitle}>Version History</div>
        </header>

        <div className={styles.list}>
          {gallery.length === 0 && (
            <div className={styles.empty}>
              No composes yet. Each <em>Compose</em> snapshot gets logged
              here — restore any entry to roll the canvas back to that state.
            </div>
          )}
          {gallery.map((g) => {
            const isActive = g.id === activeId;
            const cover =
              g.resultAssetIds[g.selectedResultIdx] ?? g.resultAssetIds[0];
            const plus = g.stack.filter((c) => c.sign === "+").length;
            const minus = g.stack.filter((c) => c.sign === "-").length;
            return (
              <div
                key={g.id}
                className={`${styles.item} ${isActive ? styles.itemActive : ""}`}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!cover) return;
                  setCtx({
                    kind: "gallery",
                    id: g.id,
                    x: e.clientX,
                    y: e.clientY,
                  });
                }}
              >
                <button
                  className={styles.itemBody}
                  onClick={() => loadEntry(g.id)}
                  title="Restore this state"
                >
                  <div className={styles.coverWrap}>
                    {cover && (
                      <img
                        src={assets[cover]?.url ?? ""}
                        alt=""
                        className={styles.cover}
                      />
                    )}
                    {g.resultAssetIds.length > 1 && (
                      <span className={styles.countBadge}>
                        ×{g.resultAssetIds.length}
                      </span>
                    )}
                  </div>
                  <div className={styles.itemMeta}>
                    <div className={styles.metaRow}>
                      <span className={styles.timeAgo}>{timeAgo(g.timestamp)}</span>
                      {g.usedMock && (
                        <span className={styles.mockChip}>mock</span>
                      )}
                    </div>
                    <div className={styles.promptLine}>
                      {g.prompt || <em className={styles.noPrompt}>(no prompt)</em>}
                    </div>
                    <div className={styles.statRow}>
                      <span className={styles.statPlus}>+{plus}</span>
                      <span className={styles.statMinus}>−{minus}</span>
                      <span className={styles.statSeed}>seed {g.seed}</span>
                    </div>
                  </div>
                </button>
                <button
                  className={styles.removeBtn}
                  onClick={() => removeEntry(g.id)}
                  aria-label="delete entry"
                  title="Delete this entry"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {ctx && (
        <>
          <div
            className={styles.ctxBackdrop}
            onClick={() => setCtx(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtx(null);
            }}
          />
          <div
            className={styles.ctxMenu}
            style={{ left: ctx.x, top: ctx.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {ctx.kind === "gallery" && (
              <>
                {(() => {
                  const g = gallery.find((x) => x.id === ctx.id);
                  if (!g) return null;
                  const cover =
                    g.resultAssetIds[g.selectedResultIdx] ?? g.resultAssetIds[0];
                  return (
                    <>
                      <button
                        className={styles.ctxItem}
                        onClick={() => {
                          loadEntry(ctx.id);
                          setCtx(null);
                        }}
                      >
                        <span className={styles.ctxIcon}>↺</span> Restore this state
                      </button>
                      <button
                        className={styles.ctxItem}
                        disabled={!cover}
                        onClick={() => {
                          if (cover) setFinalAsset(cover);
                          setCtx(null);
                        }}
                      >
                        <span className={styles.ctxIcon}>★</span> Pin result as final
                      </button>
                      <div className={styles.ctxSep} />
                      <button
                        className={styles.ctxItemDanger}
                        onClick={() => {
                          removeEntry(ctx.id);
                          setCtx(null);
                        }}
                      >
                        <span className={styles.ctxIcon}>✕</span> Delete entry
                      </button>
                    </>
                  );
                })()}
              </>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

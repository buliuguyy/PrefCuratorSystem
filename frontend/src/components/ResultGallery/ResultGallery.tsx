"use client";

import { useCurator } from "@/store/useCurator";

import styles from "./ResultGallery.module.css";

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

export function ResultGallery() {
  const gallery = useCurator((s) => s.gallery);
  const activeId = useCurator((s) => s.activeGalleryId);
  const loadEntry = useCurator((s) => s.loadGalleryEntry);
  const removeEntry = useCurator((s) => s.removeGalleryEntry);
  const assets = useCurator((s) => s.assets);

  return (
    <aside className={styles.panel}>
      <header className={styles.head}>
        <div className={styles.title}>Result Gallery</div>
        <div className={styles.subtitle}>
          {gallery.length === 0
            ? "no composes yet"
            : `${gallery.length} compose${gallery.length === 1 ? "" : "s"} this session`}
        </div>
      </header>

      <div className={styles.list}>
        {gallery.length === 0 && (
          <div className={styles.empty}>
            <p>
              Each <em>Compose</em> snapshot — its candidates, fusion stack,
              intensity sliders, and result images — gets pinned here.
            </p>
            <p className={styles.emptySub}>
              Click any entry to restore that exact state.
            </p>
          </div>
        )}

        {gallery.map((g) => {
          const plus = g.stack.filter((c) => c.sign === "+").length;
          const minus = g.stack.filter((c) => c.sign === "-").length;
          const isActive = g.id === activeId;
          const cover = g.resultAssetIds[g.selectedResultIdx] ?? g.resultAssetIds[0];
          return (
            <div
              key={g.id}
              className={`${styles.item} ${isActive ? styles.itemActive : ""}`}
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
    </aside>
  );
}

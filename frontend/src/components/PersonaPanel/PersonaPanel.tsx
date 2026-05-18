"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { useCurator } from "@/store/useCurator";
import { accentForConcept } from "@/types";

import styles from "./PersonaPanel.module.css";

function relTime(ts: number): string {
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return `${Math.max(1, Math.floor(diff))}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function PersonaPanel() {
  const currentUserId = useCurator((s) => s.currentUserId);
  const users = useCurator((s) => s.users);
  const personas = useCurator((s) => s.personas);
  const personasLoading = useCurator((s) => s.personasLoading);
  const personaError = useCurator((s) => s.personaError);
  const activePersonaId = useCurator((s) => s.activePersonaId);
  const stack = useCurator((s) => s.stack);
  const saveCurrentAsPersona = useCurator((s) => s.saveCurrentAsPersona);
  const updatePersonaFromCurrent = useCurator((s) => s.updatePersonaFromCurrent);
  const applyPersona = useCurator((s) => s.applyPersona);
  const deletePersona = useCurator((s) => s.deletePersona);
  const detachActivePersona = useCurator((s) => s.detachActivePersona);
  const refreshPersonas = useCurator((s) => s.refreshPersonas);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  // Reload on user switch (the store does this but this is a defensive
  // re-fire in case the panel mounted after the user was already set).
  useEffect(() => {
    if (currentUserId) void refreshPersonas();
  }, [currentUserId, refreshPersonas]);

  if (!currentUserId) {
    return (
      <aside className={styles.panel}>
        <header className={styles.head}>
          <div className={styles.title}>Idiosyncratic Preferences</div>
          <div className={styles.subtitle}>no user · sign in to save personas</div>
        </header>
        <div className={styles.empty}>
          Use the user chip on the top right to pick or create a user. Each
          user has their own evolving design profile.
        </div>
      </aside>
    );
  }

  const currentUser = users.find((u) => u.id === currentUserId);

  async function submitNew() {
    const nm = newName.trim();
    if (!nm) return;
    const created = await saveCurrentAsPersona(nm);
    if (created) {
      setNewName("");
      setCreating(false);
    }
  }

  const canSave = stack.length > 0;

  return (
    <aside className={styles.panel}>
      <header className={styles.head}>
        <div className={styles.title}>Idiosyncratic Preferences</div>
        <div className={styles.subtitle}>
          {currentUser?.name} · {personas.length} persona
          {personas.length === 1 ? "" : "s"}
        </div>
      </header>

      <div className={styles.activeBanner}>
        {activePersonaId ? (
          <>
            <div className={styles.activeLabel}>Active session</div>
            <div className={styles.activeRow}>
              <span className={styles.activeDot} />
              <span className={styles.activeName}>
                {personas.find((p) => p.id === activePersonaId)?.name ?? "(unknown)"}
              </span>
              <button
                className={styles.detachBtn}
                onClick={detachActivePersona}
                title="Stop auto-updating this persona on compose"
              >
                detach
              </button>
            </div>
            <div className={styles.activeHint}>
              auto-snapshots on every compose
            </div>
          </>
        ) : (
          <>
            <div className={styles.activeLabel}>No active persona</div>
            <div className={styles.activeHint}>
              {canSave
                ? "Save current state below to start tracking."
                : "Pick tags on a generated image to build a stack."}
            </div>
          </>
        )}
      </div>

      {personaError && <div className={styles.error}>{personaError}</div>}

      {creating ? (
        <div className={styles.newRow}>
          <input
            className={styles.newInput}
            placeholder="persona name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitNew();
              if (e.key === "Escape") {
                setCreating(false);
                setNewName("");
              }
            }}
            maxLength={60}
            autoFocus
          />
          <button
            className={styles.newOk}
            disabled={!newName.trim() || !canSave}
            onClick={submitNew}
          >
            Save
          </button>
          <button
            className={styles.newCancel}
            onClick={() => {
              setCreating(false);
              setNewName("");
            }}
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          className={styles.saveBtn}
          disabled={!canSave}
          onClick={() => setCreating(true)}
          title={
            canSave
              ? "Snapshot the current stack as a new persona"
              : "Pick at least one tag to save a persona"
          }
        >
          + Save current as persona
        </button>
      )}

      <div className={styles.list}>
        {personasLoading && (
          <div className={styles.muted}>loading personas…</div>
        )}
        {!personasLoading && personas.length === 0 && (
          <div className={styles.muted}>
            No saved personas yet. Pick a few tags, then save the stack to
            kick off a profile.
          </div>
        )}
        {personas.map((p) => {
          const active = p.id === activePersonaId;
          return (
            <div
              key={p.id}
              className={`${styles.card} ${active ? styles.cardActive : ""}`}
            >
              <div className={styles.cardHead}>
                <span className={styles.cardName} title={p.name}>
                  {p.name}
                </span>
                <span className={styles.cardTime}>{relTime(p.updated_at)}</span>
              </div>

              <div className={styles.thumbStrip}>
                {p.asset_preview_ids.length === 0 && (
                  <div className={styles.thumbPlaceholder}>no assets</div>
                )}
                {p.asset_preview_ids.map((aid) => (
                  <img
                    key={aid}
                    src={api.assetUrl(aid)}
                    alt=""
                    className={styles.thumb}
                    loading="lazy"
                    onError={(e) => {
                      // The asset bytes are server-side; if the dev server
                      // restarted but the persona file lived through it,
                      // the image won't load until applyPersona() hydrates.
                      (e.currentTarget as HTMLImageElement).style.opacity = "0.2";
                    }}
                  />
                ))}
              </div>

              <div className={styles.chips}>
                {p.concept_preview.map((c, i) => (
                  <span
                    key={i}
                    className={styles.chip}
                    style={{
                      borderColor: accentForConcept(c.dimension),
                      color: accentForConcept(c.dimension),
                    }}
                    title={
                      c.dimension === c.tag
                        ? `${c.sign}${c.dimension}`
                        : `${c.dimension} · ${c.sign}${c.tag}`
                    }
                  >
                    {c.sign}
                    {c.dimension === c.tag ? c.dimension : c.tag}
                  </span>
                ))}
                {p.concept_count > p.concept_preview.length && (
                  <span className={styles.chipMore}>
                    +{p.concept_count - p.concept_preview.length}
                  </span>
                )}
              </div>

              <div className={styles.cardFoot}>
                <span className={styles.stat}>
                  <span className={styles.statPlus}>+{p.plus_count}</span>
                  <span className={styles.statMinus}>−{p.minus_count}</span>
                  <span className={styles.statSeed}>seed {p.seed}</span>
                </span>
                <div className={styles.cardActions}>
                  <button
                    className={styles.actionBtn}
                    onClick={() => applyPersona(p.id)}
                    title="Load this persona — restores its images and stack, then auto-tracks future composes"
                  >
                    Apply
                  </button>
                  <button
                    className={styles.actionBtn}
                    disabled={!canSave}
                    onClick={() => updatePersonaFromCurrent(p.id)}
                    title="Overwrite this persona with the current stack"
                  >
                    Update
                  </button>
                  <button
                    className={styles.actionDel}
                    onClick={async () => {
                      const ok = window.confirm(
                        `Delete persona "${p.name}"?`,
                      );
                      if (ok) await deletePersona(p.id);
                    }}
                    title="Delete this persona"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

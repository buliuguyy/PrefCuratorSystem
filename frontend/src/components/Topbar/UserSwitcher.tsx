"use client";

import { useEffect, useRef, useState } from "react";

import { useCurator } from "@/store/useCurator";

import styles from "./UserSwitcher.module.css";

/** "Sign-in" chip in the top bar. No password — just a display name that
 *  the backend stamps with a stable id. Drives which user's personas the
 *  PersonaPanel shows and which user gets auto-snapshotted on compose. */
export function UserSwitcher() {
  const users = useCurator((s) => s.users);
  const currentUserId = useCurator((s) => s.currentUserId);
  const setCurrentUser = useCurator((s) => s.setCurrentUser);
  const createUser = useCurator((s) => s.createUser);
  const deleteUser = useCurator((s) => s.deleteUser);

  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const current = users.find((u) => u.id === currentUserId);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (creating && inputRef.current) inputRef.current.focus();
  }, [creating]);

  async function submitNew() {
    const nm = newName.trim();
    if (!nm) return;
    const u = await createUser(nm);
    setNewName("");
    setCreating(false);
    if (u) await setCurrentUser(u.id);
    setOpen(false);
  }

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        className={styles.chip}
        onClick={() => setOpen((o) => !o)}
        title={current ? `Signed in as ${current.name}` : "Pick a user"}
      >
        <span className={styles.avatar}>
          {current ? current.name.slice(0, 1).toUpperCase() : "·"}
        </span>
        <span className={styles.name}>
          {current ? current.name : <em className={styles.guest}>no user</em>}
        </span>
        <span className={styles.chev}>▾</span>
      </button>

      {open && (
        <div className={styles.menu} role="menu">
          <div className={styles.menuHead}>Switch user</div>
          {users.length === 0 && (
            <div className={styles.empty}>
              No users yet — create one to start saving personas.
            </div>
          )}
          {users.map((u) => (
            <div key={u.id} className={styles.row}>
              <button
                className={`${styles.rowBody} ${
                  u.id === currentUserId ? styles.rowBodyActive : ""
                }`}
                onClick={async () => {
                  if (u.id !== currentUserId) await setCurrentUser(u.id);
                  setOpen(false);
                }}
              >
                <span className={styles.rowAvatar}>
                  {u.name.slice(0, 1).toUpperCase()}
                </span>
                <span className={styles.rowName}>{u.name}</span>
                {u.id === currentUserId && (
                  <span className={styles.activeDot} aria-label="active" />
                )}
              </button>
              <button
                className={styles.rowDel}
                title="Delete user (irreversible)"
                onClick={async (e) => {
                  e.stopPropagation();
                  const ok = window.confirm(
                    `Delete user "${u.name}" and all their personas?`,
                  );
                  if (ok) await deleteUser(u.id);
                }}
              >
                ✕
              </button>
            </div>
          ))}

          <div className={styles.sep} />

          {creating ? (
            <div className={styles.newRow}>
              <input
                ref={inputRef}
                className={styles.newInput}
                placeholder="display name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitNew();
                  if (e.key === "Escape") {
                    setCreating(false);
                    setNewName("");
                  }
                }}
                maxLength={40}
              />
              <button
                className={styles.newOk}
                onClick={submitNew}
                disabled={!newName.trim()}
              >
                Add
              </button>
            </div>
          ) : (
            <button
              className={styles.newBtn}
              onClick={() => setCreating(true)}
            >
              + new user
            </button>
          )}
        </div>
      )}
    </div>
  );
}

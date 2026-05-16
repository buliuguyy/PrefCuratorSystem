"use client";

import { useEffect, useRef, useState } from "react";

import { getInitialUserId, useCurator } from "@/store/useCurator";

import styles from "./Topbar.module.css";
import { UserSwitcher } from "./UserSwitcher";

export function Topbar() {
  const prompt = useCurator((s) => s.prompt);
  const setPrompt = useCurator((s) => s.setPrompt);
  const generate = useCurator((s) => s.generate);
  const uploadAsset = useCurator((s) => s.uploadAsset);
  const loading = useCurator((s) => s.loadingCandidates);
  const composeError = useCurator((s) => s.composeError);
  const refreshUsers = useCurator((s) => s.refreshUsers);
  const setCurrentUser = useCurator((s) => s.setCurrentUser);
  const users = useCurator((s) => s.users);
  const currentUserId = useCurator((s) => s.currentUserId);

  // Boot: pull users from backend + restore the last user this browser used.
  useEffect(() => {
    let mounted = true;
    (async () => {
      await refreshUsers();
      if (!mounted) return;
      const stored = getInitialUserId();
      const list = useCurator.getState().users;
      const pick =
        stored && list.find((u) => u.id === stored)
          ? stored
          : list[0]?.id ?? null;
      if (pick && useCurator.getState().currentUserId !== pick) {
        await setCurrentUser(pick);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [refreshUsers, setCurrentUser]);

  // If users list grows and we somehow have no current user, latch onto the first.
  useEffect(() => {
    if (!currentUserId && users.length > 0) {
      void setCurrentUser(users[0].id);
    }
  }, [users, currentUserId, setCurrentUser]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function onFilesChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const f of Array.from(files)) await uploadAsset(f);
    } finally {
      setUploading(false);
      // reset so re-picking the same file fires onChange again
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <header className={styles.topbar}>
      <div className={styles.brand}>
        <div className={styles.brandMark} aria-hidden />
        <span>PrefCurator</span>
      </div>

      <div className={styles.promptGroup}>
        <span className={styles.promptLabel}>Prompt</span>
        <input
          type="text"
          className={styles.promptInput}
          placeholder="Design a house ..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !loading) generate();
          }}
        />
        <button
          className={styles.generateBtn}
          onClick={() => generate()}
          disabled={loading || !prompt.trim()}
        >
          {loading ? "Generating…" : "Generate"}
        </button>
        <button
          className={styles.uploadBtn}
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          title="Upload image(s) — treated identically to generated candidates"
        >
          {uploading ? "Uploading…" : "Upload"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className={styles.hiddenFileInput}
          onChange={onFilesChosen}
        />
      </div>

      <div className={styles.right}>
        {composeError && <span className={styles.error}>{composeError}</span>}
        <UserSwitcher />
        <span className={styles.phaseChip}>phase 8</span>
      </div>
    </header>
  );
}

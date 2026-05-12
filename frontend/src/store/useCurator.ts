"use client";

import { create } from "zustand";

import type {
  AssetRef,
  Dimension,
  FusionStack,
  Group,
  Sign,
  TagResult,
} from "@/types";

/** One curated concept the designer picked from a specific asset. */
export interface CuratedConcept {
  /** Stable id for ordering / dedupe (assetId + dimension + sign). */
  key: string;
  assetId: string;
  dimension: Dimension;
  tags: string[];
  sign: Sign;
  alpha: number;
}

interface CuratorState {
  prompt: string;
  candidates: AssetRef[];
  loadingCandidates: boolean;

  /** Per-asset cache of smart-tag results so re-opening the popover is free. */
  tagCache: Record<string, TagResult>;

  /** Flat list of curated concepts; serialized into a FusionStack on compose. */
  stack: CuratedConcept[];

  // ─── mutations ──────────────────────────────────────────────────────────
  setPrompt(p: string): void;
  setCandidates(c: AssetRef[]): void;
  setLoadingCandidates(b: boolean): void;
  setTagsForAsset(assetId: string, result: TagResult): void;
  toggleConcept(
    assetId: string,
    dimension: Dimension,
    tags: string[],
    sign: Sign,
  ): void;
  removeConcept(key: string): void;
  clearStack(): void;

  // ─── derived ────────────────────────────────────────────────────────────
  /** Group the flat stack by (assetId, sign) for sending to the backend. */
  toFusionStack(seed?: number): FusionStack | null;
}

function conceptKey(
  assetId: string,
  dimension: Dimension,
  sign: Sign,
): string {
  return `${assetId}|${dimension}|${sign}`;
}

export const useCurator = create<CuratorState>((set, get) => ({
  prompt: "",
  candidates: [],
  loadingCandidates: false,
  tagCache: {},
  stack: [],

  setPrompt: (p) => set({ prompt: p }),
  setCandidates: (c) => set({ candidates: c, stack: [], tagCache: {} }),
  setLoadingCandidates: (b) => set({ loadingCandidates: b }),

  setTagsForAsset: (assetId, result) =>
    set((s) => ({ tagCache: { ...s.tagCache, [assetId]: result } })),

  toggleConcept: (assetId, dimension, tags, sign) =>
    set((s) => {
      const key = conceptKey(assetId, dimension, sign);
      const existing = s.stack.find((c) => c.key === key);

      if (existing) {
        // Same dimension+sign already selected → toggle off if tags identical,
        // otherwise overwrite tags.
        const sameTags =
          existing.tags.length === tags.length &&
          existing.tags.every((t, i) => t === tags[i]);
        if (sameTags) {
          return { stack: s.stack.filter((c) => c.key !== key) };
        }
        return {
          stack: s.stack.map((c) => (c.key === key ? { ...c, tags } : c)),
        };
      }

      // Also remove the opposite-sign version (can't be +Style and −Style at once).
      const opposite = conceptKey(
        assetId,
        dimension,
        sign === "+" ? "-" : "+",
      );
      const cleaned = s.stack.filter((c) => c.key !== opposite);

      const concept: CuratedConcept = {
        key,
        assetId,
        dimension,
        tags,
        sign,
        alpha: 1.0,
      };
      return { stack: [...cleaned, concept] };
    }),

  removeConcept: (key) =>
    set((s) => ({ stack: s.stack.filter((c) => c.key !== key) })),

  clearStack: () => set({ stack: [] }),

  toFusionStack: (seed = 420) => {
    const { stack, candidates } = get();
    if (stack.length === 0) return null;

    // Group concepts by (assetId, sign).
    type Key = string;
    const groups: Record<Key, Group> = {};
    for (const c of stack) {
      const k = `${c.assetId}|${c.sign}`;
      if (!groups[k]) {
        groups[k] = { asset_id: c.assetId, sign: c.sign, concepts: [] };
      }
      groups[k].concepts.push({
        dimension: c.dimension,
        tags: c.tags,
        alpha: c.alpha,
        name: `${c.assetId.slice(0, 4)}_${c.dimension.toLowerCase()}`,
      });
    }

    // Base = the asset with the most positive concepts, falling back to first candidate.
    const positiveCounts: Record<string, number> = {};
    for (const c of stack) {
      if (c.sign === "+") {
        positiveCounts[c.assetId] = (positiveCounts[c.assetId] ?? 0) + 1;
      }
    }
    const base =
      Object.entries(positiveCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ??
      candidates[0]?.id ??
      stack[0].assetId;

    return {
      base_asset_id: base,
      groups: Object.values(groups),
      num_samples: 1,
      seed,
    };
  },
}));

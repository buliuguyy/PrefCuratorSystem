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

/**
 * One curated entry in the stack. Always grouped per (asset, dimension, sign);
 * its `tags` array holds only the individual tags the designer ticked under
 * that sign — not the whole dimension's suggestion list.
 */
export interface CuratedConcept {
  /** Stable id for ordering / dedupe: `${assetId}|${dimension}|${sign}`. */
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

  tagCache: Record<string, TagResult>;
  stack: CuratedConcept[];

  // ─── mutations ──────────────────────────────────────────────────────────
  setPrompt(p: string): void;
  setCandidates(c: AssetRef[]): void;
  setLoadingCandidates(b: boolean): void;
  setTagsForAsset(assetId: string, result: TagResult): void;

  /**
   * Toggle a single tag (one of the suggestion strings) for a given asset+
   * dimension under the requested sign.
   *
   * Rules (the same tag for the same asset+dimension):
   *   neutral  + click("+")     -> add to "+" group
   *   neutral  + click("-")     -> add to "-" group
   *   liked    + click("+")     -> remove (toggle off)
   *   liked    + click("-")     -> move from "+" to "-"
   *   disliked + click("+")     -> move from "-" to "+"
   *   disliked + click("-")     -> remove (toggle off)
   * The empty group is pruned automatically.
   */
  toggleTag(
    assetId: string,
    dimension: Dimension,
    tag: string,
    sign: Sign,
  ): void;

  /** Returns "+" / "-" / null for the current state of this tag. */
  tagState(
    assetId: string,
    dimension: Dimension,
    tag: string,
  ): Sign | null;

  removeConcept(key: string): void;
  clearStack(): void;

  toFusionStack(seed?: number): FusionStack | null;
}

function conceptKey(
  assetId: string,
  dimension: Dimension,
  sign: Sign,
): string {
  return `${assetId}|${dimension}|${sign}`;
}

function withTagAdded(
  stack: CuratedConcept[],
  assetId: string,
  dimension: Dimension,
  tag: string,
  sign: Sign,
): CuratedConcept[] {
  const key = conceptKey(assetId, dimension, sign);
  const existing = stack.find((c) => c.key === key);
  if (existing) {
    if (existing.tags.includes(tag)) return stack;
    return stack.map((c) =>
      c.key === key ? { ...c, tags: [...c.tags, tag] } : c,
    );
  }
  return [
    ...stack,
    {
      key,
      assetId,
      dimension,
      tags: [tag],
      sign,
      alpha: 1.0,
    },
  ];
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

  tagState: (assetId, dimension, tag) => {
    const { stack } = get();
    for (const c of stack) {
      if (c.assetId === assetId && c.dimension === dimension && c.tags.includes(tag)) {
        return c.sign;
      }
    }
    return null;
  },

  toggleTag: (assetId, dimension, tag, sign) =>
    set((s) => {
      const targetKey = conceptKey(assetId, dimension, sign);
      const otherKey = conceptKey(assetId, dimension, sign === "+" ? "-" : "+");

      const prevInTarget =
        s.stack.find((c) => c.key === targetKey)?.tags.includes(tag) ?? false;

      // Strip this tag from both possible groups first (prune empty groups).
      let next = s.stack
        .map((c) =>
          c.key === targetKey || c.key === otherKey
            ? { ...c, tags: c.tags.filter((t) => t !== tag) }
            : c,
        )
        .filter((c) => c.tags.length > 0);

      // If it WASN'T in target before this click, we should ADD it.
      // If it WAS in target, the click toggles it off (already stripped above).
      if (!prevInTarget) {
        next = withTagAdded(next, assetId, dimension, tag, sign);
      }
      return { stack: next };
    }),

  removeConcept: (key) =>
    set((s) => ({ stack: s.stack.filter((c) => c.key !== key) })),

  clearStack: () => set({ stack: [] }),

  toFusionStack: (seed = 420) => {
    const { stack, candidates } = get();
    if (stack.length === 0) return null;

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

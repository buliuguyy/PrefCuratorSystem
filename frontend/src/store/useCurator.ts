"use client";

import { create } from "zustand";

import { api } from "@/lib/api";
import {
  ALL_DIMENSIONS,
  type Asset,
  type CanvasItem,
  type ComposedAsset,
  type Dimension,
  type FusionStack,
  type GeneratedAsset,
  type Group,
  type LassoAsset,
  type Sign,
  type TagResult,
  type UploadedAsset,
} from "@/types";

/**
 * Per-tag curated concept. Each individual tag the designer picks gets its
 * OWN entry in the stack — its own alpha, its own slider in the Intensity
 * Mixer, its own row in the Fusion Stack panel. Concepts are grouped by
 * (assetId, sign) only at compose time when building the FusionStack.
 */
export interface CuratedConcept {
  /** `${assetId}|${dimension}|${tag}|${sign}` — globally unique. */
  key: string;
  assetId: string;
  dimension: Dimension;
  tag: string;
  sign: Sign;
  alpha: number;
}

export type View = "canvas" | "refiner";

export interface GalleryEntry {
  id: string;
  timestamp: number;
  prompt: string;
  stack: CuratedConcept[];
  seed: number;
  resultAssetIds: string[];
  selectedResultIdx: number;
  numSamples: number;
  usedMock: boolean;
  /** IP-Composer diagnostics — captured at compose-time so replaying a
   *  gallery entry preserves the drift banner / weak-signal chips. */
  drift?: number | null;
  driftWarn?: boolean;
  weakSlots?: string[];
}

// ─── canvas auto-layout helpers ────────────────────────────────────────────

const TILE_W = 200;
const TILE_H = 200;
const GAP = 18;
const ROW_TOP = 32;
const COL_LEFT = 32;
const ROW_WIDTH = 4;

function nextSlot(existing: CanvasItem[], inset = 0): { x: number; y: number } {
  if (existing.length === 0) return { x: COL_LEFT + inset, y: ROW_TOP };
  const occupied = new Set<string>();
  for (const it of existing) {
    const col = Math.round((it.x - COL_LEFT) / (TILE_W + GAP));
    const row = Math.round((it.y - ROW_TOP) / (TILE_H + GAP));
    occupied.add(`${row},${col}`);
  }
  for (let r = 0; r < 200; r++) {
    for (let c = 0; c < ROW_WIDTH; c++) {
      if (!occupied.has(`${r},${c}`)) {
        return {
          x: COL_LEFT + c * (TILE_W + GAP) + inset,
          y: ROW_TOP + r * (TILE_H + GAP),
        };
      }
    }
  }
  return { x: COL_LEFT + inset, y: ROW_TOP };
}

function nextLabel(
  assets: Record<string, Asset>,
  origin: Asset["origin"],
): string {
  const prefix = {
    generated: "G",
    composed: "R",
    lasso: "L",
    uploaded: "U",
  }[origin];
  const count = Object.values(assets).filter((a) => a.origin === origin).length;
  return `${prefix}${count + 1}`;
}

// ─── store interface ───────────────────────────────────────────────────────

interface CuratorState {
  prompt: string;

  assets: Record<string, Asset>;

  canvasItems: CanvasItem[];
  canvasPan: { x: number; y: number };
  canvasZoom: number;
  /** Asset ids currently in the multi-selection set. Drag any of them and
   *  they all move together. Shift+click toggles membership. */
  selectedAssetIds: string[];

  loadingCandidates: boolean;
  stack: CuratedConcept[];
  seed: number;
  numSamples: number;

  view: View;
  isComposing: boolean;
  composeError: string | null;
  resultAssetIds: string[];
  selectedResultIdx: number;
  resultUsedMock: boolean;
  /** Diagnostics from the most recent compose call. Reset on next compose. */
  resultDrift: number | null;
  resultDriftWarn: boolean;
  /** Concept.name strings — used to mark a Fusion Stack row as "weak ref". */
  resultWeakSlots: string[];

  gallery: GalleryEntry[];
  activeGalleryId: string | null;

  /** When non-null, the canvas mounts the lasso drawing overlay over the
   *  named tile. Set by right-click → "Lasso this image". */
  lassoMode: { sourceAssetId: string } | null;

  /** When non-null, SmartTagPopover opens for this asset. Driven by:
   *   - the "Tag" entry in the tile's right-click menu (Phase 7.9)
   *   - commitLasso after the API returns
   *   - clicking on a persisted polygon overlay
   */
  activePopoverAssetId: string | null;

  /** When non-null, the PreviewOverlay shows this asset at large size.
   *  Driven by left-click on a tile. */
  previewAssetId: string | null;

  /** Per-asset "tagging in flight" flag. Set true when pre-tag or popover
   *  triggers a smartTag fetch; cleared on success/error. Surfaced in the
   *  right-click menu's Tag entry as "Tagging…". Also gates the popover's
   *  own fetch so the same asset isn't tagged twice concurrently. */
  taggingAssets: Record<string, boolean>;

  // ─── mutations ──────────────────────────────────────────────────────────
  setPrompt(p: string): void;
  setLoadingCandidates(b: boolean): void;
  setView(v: View): void;
  reseed(): void;
  setNumSamples(n: number): void;
  setSelectedResultIdx(i: number): void;

  registerAssets(assets: Asset[], inset?: number): void;
  setAssetTags(assetId: string, tags: TagResult): void;
  setOriginalDims(assetId: string, w: number, h: number): void;
  moveCanvasItem(assetId: string, x: number, y: number): void;
  /** Move many items by absolute deltas — used for multi-select drag. */
  moveCanvasItems(deltas: { assetId: string; x: number; y: number }[]): void;
  raiseCanvasItem(assetId: string): void;
  setCanvasPan(x: number, y: number): void;
  setCanvasZoom(z: number): void;

  toggleSelectAsset(assetId: string): void;
  setSelectedAssetIds(ids: string[]): void;
  clearSelection(): void;

  toggleTag(
    assetId: string,
    dimension: Dimension,
    tag: string,
    sign: Sign,
  ): void;
  tagState(
    assetId: string,
    dimension: Dimension,
    tag: string,
  ): Sign | null;
  removeConcept(key: string): void;
  clearStack(): void;
  updateAlpha(key: string, alpha: number): void;
  /** Reorder the per-tag concept list: move the concept at `fromIndex` so it
   *  sits at `toIndex` after the move. Drives both UI order in
   *  FusionStackPreview and group order in the FusionStack payload sent to
   *  backend — and therefore which asset becomes `base_asset_id`. */
  reorderConcept(fromIndex: number, toIndex: number): void;

  toFusionStack(seed?: number, numSamples?: number): FusionStack | null;
  compose(): Promise<void>;

  generate(): Promise<void>;

  startLasso(sourceAssetId: string): void;
  cancelLasso(): void;
  commitLasso(polygonImg: [number, number][]): Promise<void>;
  setActivePopover(assetId: string | null): void;
  setPreview(assetId: string | null): void;
  setTagging(assetId: string, active: boolean): void;

  /** Upload a local image file, register it as an `uploaded`-origin Asset
   *  with the same lifecycle as a generated candidate (canvas tile +
   *  background pre-tag). */
  uploadAsset(file: File): Promise<void>;

  loadGalleryEntry(id: string): void;
  removeGalleryEntry(id: string): void;
}

function conceptKey(
  assetId: string,
  dimension: Dimension,
  tag: string,
  sign: Sign,
): string {
  return `${assetId}|${dimension}|${tag}|${sign}`;
}

function cloneStack(stack: CuratedConcept[]): CuratedConcept[] {
  return stack.map((c) => ({ ...c }));
}

export const useCurator = create<CuratorState>((set, get) => ({
  prompt: "",
  assets: {},
  canvasItems: [],
  canvasPan: { x: 0, y: 0 },
  canvasZoom: 1,
  selectedAssetIds: [],

  loadingCandidates: false,
  stack: [],
  seed: 420,
  numSamples: 1,

  view: "canvas",
  isComposing: false,
  composeError: null,
  resultAssetIds: [],
  selectedResultIdx: 0,
  resultUsedMock: false,
  resultDrift: null,
  resultDriftWarn: false,
  resultWeakSlots: [],

  gallery: [],
  activeGalleryId: null,

  lassoMode: null,
  activePopoverAssetId: null,
  previewAssetId: null,
  taggingAssets: {},

  setPrompt: (p) => set({ prompt: p }),
  setLoadingCandidates: (b) => set({ loadingCandidates: b }),
  setView: (v) => set({ view: v }),
  reseed: () => set({ seed: Math.floor(Math.random() * 1_000_000) }),
  setNumSamples: (n) => set({ numSamples: Math.max(1, Math.min(4, n)) }),
  setSelectedResultIdx: (i) => set({ selectedResultIdx: i }),

  registerAssets: (newAssets, inset = 0) =>
    set((s) => {
      const assets = { ...s.assets };
      const items = [...s.canvasItems];
      let topZ = items.reduce((m, it) => Math.max(m, it.z), 0);
      for (const a of newAssets) {
        if (!assets[a.id]) {
          assets[a.id] = { ...a, label: a.label || nextLabel(assets, a.origin) };
        }
        if (!items.some((it) => it.assetId === a.id)) {
          const pos = nextSlot(items, inset);
          topZ += 1;
          items.push({
            assetId: a.id,
            x: pos.x,
            y: pos.y,
            width: TILE_W,
            height: TILE_H,
            z: topZ,
          });
        }
      }
      return { assets, canvasItems: items };
    }),

  setAssetTags: (assetId, tags) =>
    set((s) => {
      const a = s.assets[assetId];
      if (!a) return {};
      return { assets: { ...s.assets, [assetId]: { ...a, tags } as Asset } };
    }),

  setOriginalDims: (assetId, w, h) =>
    set((s) => {
      const a = s.assets[assetId];
      if (!a) return {};
      if (a.originalW === w && a.originalH === h) return {};
      return {
        assets: {
          ...s.assets,
          [assetId]: { ...a, originalW: w, originalH: h } as Asset,
        },
      };
    }),

  moveCanvasItem: (assetId, x, y) =>
    set((s) => ({
      canvasItems: s.canvasItems.map((it) =>
        it.assetId === assetId ? { ...it, x, y } : it,
      ),
    })),

  moveCanvasItems: (deltas) =>
    set((s) => {
      const m = new Map(deltas.map((d) => [d.assetId, d]));
      return {
        canvasItems: s.canvasItems.map((it) => {
          const d = m.get(it.assetId);
          return d ? { ...it, x: d.x, y: d.y } : it;
        }),
      };
    }),

  raiseCanvasItem: (assetId) =>
    set((s) => {
      const topZ = s.canvasItems.reduce((m, it) => Math.max(m, it.z), 0);
      return {
        canvasItems: s.canvasItems.map((it) =>
          it.assetId === assetId ? { ...it, z: topZ + 1 } : it,
        ),
      };
    }),

  setCanvasPan: (x, y) => set({ canvasPan: { x, y } }),
  setCanvasZoom: (z) => set({ canvasZoom: Math.max(0.2, Math.min(4, z)) }),

  toggleSelectAsset: (assetId) =>
    set((s) => {
      const has = s.selectedAssetIds.includes(assetId);
      return {
        selectedAssetIds: has
          ? s.selectedAssetIds.filter((id) => id !== assetId)
          : [...s.selectedAssetIds, assetId],
      };
    }),
  setSelectedAssetIds: (ids) => set({ selectedAssetIds: ids }),
  clearSelection: () => set({ selectedAssetIds: [] }),

  tagState: (assetId, dimension, tag) => {
    const { stack } = get();
    for (const c of stack) {
      if (
        c.assetId === assetId &&
        c.dimension === dimension &&
        c.tag === tag
      ) {
        return c.sign;
      }
    }
    return null;
  },

  toggleTag: (assetId, dimension, tag, sign) =>
    set((s) => {
      const targetKey = conceptKey(assetId, dimension, tag, sign);
      const otherKey = conceptKey(
        assetId,
        dimension,
        tag,
        sign === "+" ? "-" : "+",
      );
      const inTarget = s.stack.some((c) => c.key === targetKey);
      // toggle off if same sign clicked again
      if (inTarget) {
        return { stack: s.stack.filter((c) => c.key !== targetKey) };
      }
      // strip from other-sign group + append new
      return {
        stack: [
          ...s.stack.filter((c) => c.key !== otherKey),
          { key: targetKey, assetId, dimension, tag, sign, alpha: 1.0 },
        ],
      };
    }),

  removeConcept: (key) =>
    set((s) => ({ stack: s.stack.filter((c) => c.key !== key) })),

  clearStack: () => set({ stack: [] }),

  updateAlpha: (key, alpha) =>
    set((s) => ({
      stack: s.stack.map((c) => (c.key === key ? { ...c, alpha } : c)),
    })),

  reorderConcept: (fromIndex, toIndex) =>
    set((s) => {
      if (fromIndex === toIndex) return {};
      if (fromIndex < 0 || fromIndex >= s.stack.length) return {};
      const clamped = Math.max(0, Math.min(s.stack.length - 1, toIndex));
      const next = s.stack.slice();
      const [moved] = next.splice(fromIndex, 1);
      next.splice(clamped, 0, moved);
      return { stack: next };
    }),

  toFusionStack: (seed, numSamples) => {
    const state = get();
    const { stack } = state;
    if (stack.length === 0) return null;
    const usedSeed = seed ?? state.seed;
    const usedSamples = numSamples ?? state.numSamples;

    const groups: Record<string, Group> = {};
    for (const c of stack) {
      const k = `${c.assetId}|${c.sign}`;
      if (!groups[k]) {
        groups[k] = { asset_id: c.assetId, sign: c.sign, concepts: [] };
      }
      groups[k].concepts.push({
        dimension: c.dimension,
        tags: [c.tag],
        alpha: c.alpha,
        name: `${c.assetId.slice(0, 4)}_${c.dimension.toLowerCase()}_${c.tag
          .slice(0, 12)
          .replace(/\s+/g, "_")}`,
      });
    }

    // The asset of the FIRST positive concept in the (user-orderable) stack
    // becomes the IP-Composer base. Falls back to the first concept overall
    // if everything is disliked (unusual but defensive).
    const firstPositive = stack.find((c) => c.sign === "+");
    const base = firstPositive?.assetId ?? stack[0].assetId;

    return {
      base_asset_id: base,
      groups: Object.values(groups),
      num_samples: usedSamples,
      seed: usedSeed,
    };
  },

  generate: async () => {
    const state = get();
    if (!state.prompt.trim()) return;
    set({ loadingCandidates: true, composeError: null });
    try {
      // Stream variant: each Gemini call lands one at a time, gets registered
      // on the canvas immediately, and starts its own background pre-tag —
      // so the user sees tiles appear progressively rather than after the
      // slowest variant. Falls back to the batch endpoint if streaming
      // isn't available (older mock, hypothetical proxy that buffers).
      const prompt = state.prompt.trim();
      // Stagger pre-tag fires so the VLM proxy isn't hit with 4 concurrent
      // requests the instant candidates land — that triggered transient
      // upstream errors against the nuwaflux proxy during Phase 7 testing.
      let preTagDelay = 0;
      const PRE_TAG_STAGGER_MS = 250;
      const firePreTag = (assetId: string) => {
        const delay = preTagDelay;
        preTagDelay += PRE_TAG_STAGGER_MS;
        setTimeout(() => {
          const a = get().assets[assetId];
          if (!a || a.tags || get().taggingAssets[assetId]) return;
          get().setTagging(assetId, true);
          api
            .smartTag(assetId, [...ALL_DIMENSIONS])
            .then((tagResult) => {
              const cur = get().assets[assetId];
              if (cur && !cur.tags) get().setAssetTags(assetId, tagResult);
            })
            .catch(() => {
              /* pre-tag failures are silent — user can click to retry */
            })
            .finally(() => get().setTagging(assetId, false));
        }, delay);
      };

      const stream = api.streamCandidates;
      if (typeof stream === "function") {
        await stream(prompt, 4, (c) => {
          get().registerAssets([c]);
          firePreTag(c.id);
        });
      } else {
        const res = await api.generateCandidates(prompt, 4);
        const candidates = res.candidates as GeneratedAsset[];
        state.registerAssets(candidates);
        for (const c of candidates) firePreTag(c.id);
      }
    } catch (e) {
      set({ composeError: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ loadingCandidates: false });
    }
  },

  compose: async () => {
    const state = get();
    const fs = state.toFusionStack(state.seed, state.numSamples);
    if (!fs) {
      set({ composeError: "Pick at least one tag before composing." });
      return;
    }
    set({ isComposing: true, composeError: null });
    try {
      const galleryEntryId = `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const res = await api.compose(fs);

      let results: ComposedAsset[] = res.results ?? [];
      if (results.length === 0) {
        const ids = res.result_asset_ids ?? (res.result_asset_id ? [res.result_asset_id] : []);
        results = ids.map((id, i) => ({
          id,
          url: api.assetUrl(id),
          origin: "composed" as const,
          createdAt: Date.now(),
          label: "",
          prompt: state.prompt,
          galleryEntryId,
          variantIdx: i,
          numSamples: state.numSamples,
          seed: res.seed,
          fusionStack: cloneStack(state.stack).map((c) => ({
            assetId: c.assetId,
            dimension: c.dimension,
            tag: c.tag,
            sign: c.sign,
            alpha: c.alpha,
          })),
          sourceAssetIds: [...new Set(state.stack.map((c) => c.assetId))],
          usedMock: res.used_mock,
        }));
      } else {
        results = results.map((r) => ({ ...r, galleryEntryId }));
      }

      state.registerAssets(results, 12);

      const ids = results.map((r) => r.id);
      const drift = res.drift ?? null;
      const driftWarn = res.drift_warn ?? false;
      const weakSlots = res.weak_slots ?? [];
      const entry: GalleryEntry = {
        id: galleryEntryId,
        timestamp: Date.now(),
        prompt: state.prompt,
        stack: cloneStack(state.stack),
        seed: state.seed,
        resultAssetIds: ids,
        selectedResultIdx: 0,
        numSamples: state.numSamples,
        usedMock: res.used_mock,
        drift,
        driftWarn,
        weakSlots,
      };

      set({
        isComposing: false,
        resultAssetIds: ids,
        selectedResultIdx: 0,
        resultUsedMock: res.used_mock,
        resultDrift: drift,
        resultDriftWarn: driftWarn,
        resultWeakSlots: weakSlots,
        view: "refiner",
        gallery: [entry, ...get().gallery].slice(0, 30),
        activeGalleryId: entry.id,
      });
    } catch (e) {
      set({
        isComposing: false,
        composeError: e instanceof Error ? e.message : String(e),
      });
    }
  },

  startLasso: (sourceAssetId) =>
    set((s) =>
      s.assets[sourceAssetId] ? { lassoMode: { sourceAssetId } } : {},
    ),

  cancelLasso: () => set({ lassoMode: null }),

  setActivePopover: (assetId) => set({ activePopoverAssetId: assetId }),
  setPreview: (assetId) => set({ previewAssetId: assetId }),
  setTagging: (assetId, active) =>
    set((s) => {
      if (!!s.taggingAssets[assetId] === active) return {};
      const next = { ...s.taggingAssets };
      if (active) next[assetId] = true;
      else delete next[assetId];
      return { taggingAssets: next };
    }),

  uploadAsset: async (file) => {
    set({ composeError: null });
    try {
      const asset: UploadedAsset = await api.uploadAsset(file);
      get().registerAssets([asset]);
      // Mirror the generated-candidate flow: kick off a background pre-tag
      // so right-clicking the tile shows tags instantly.
      const taggingFire = () => {
        const a = get().assets[asset.id];
        if (!a || a.tags || get().taggingAssets[asset.id]) return;
        get().setTagging(asset.id, true);
        api
          .smartTag(asset.id, [...ALL_DIMENSIONS])
          .then((tagResult) => {
            const cur = get().assets[asset.id];
            if (cur && !cur.tags) get().setAssetTags(asset.id, tagResult);
          })
          .catch(() => {
            /* silent */
          })
          .finally(() => get().setTagging(asset.id, false));
      };
      taggingFire();
    } catch (e) {
      set({ composeError: e instanceof Error ? e.message : String(e) });
    }
  },

  commitLasso: async (polygonImg) => {
    const state = get();
    const mode = state.lassoMode;
    if (!mode) return;
    const parent = state.assets[mode.sourceAssetId];
    if (!parent || polygonImg.length < 3) {
      set({ lassoMode: null });
      return;
    }

    set({ lassoMode: null });

    try {
      const res = await api.lasso(
        parent.id,
        polygonImg,
        [] as never as Dimension[],
      );

      const lassoAsset: LassoAsset = {
        id: res.cropped_asset_id,
        url: api.assetUrl(res.cropped_asset_id) || parent.url,
        origin: "lasso",
        createdAt: Date.now(),
        label: "",
        parentAssetId: parent.id,
        polygon: polygonImg,
      };
      state.registerAssets([lassoAsset], 8);

      const tagResult: TagResult = {
        asset_id: lassoAsset.id,
        tags: res.tags as Partial<Record<Dimension, string[]>>,
      };
      get().setAssetTags(lassoAsset.id, tagResult);
      set({ activePopoverAssetId: lassoAsset.id });
    } catch (e) {
      set({ composeError: e instanceof Error ? e.message : String(e) });
    }
  },

  loadGalleryEntry: (id) => {
    const { gallery } = get();
    const entry = gallery.find((g) => g.id === id);
    if (!entry) return;
    set({
      prompt: entry.prompt,
      stack: cloneStack(entry.stack),
      seed: entry.seed,
      numSamples: entry.numSamples,
      resultAssetIds: entry.resultAssetIds,
      selectedResultIdx: entry.selectedResultIdx,
      resultUsedMock: entry.usedMock,
      resultDrift: entry.drift ?? null,
      resultDriftWarn: entry.driftWarn ?? false,
      resultWeakSlots: entry.weakSlots ?? [],
      activeGalleryId: entry.id,
      view: "refiner",
      composeError: null,
    });
  },

  removeGalleryEntry: (id) =>
    set((s) => {
      const next = s.gallery.filter((g) => g.id !== id);
      const stillHasActive = next.some((g) => g.id === s.activeGalleryId);
      if (!stillHasActive && s.activeGalleryId === id) {
        return {
          gallery: next,
          activeGalleryId: null,
          resultAssetIds: [],
          selectedResultIdx: 0,
          view: "canvas",
        };
      }
      return { gallery: next };
    }),
}));

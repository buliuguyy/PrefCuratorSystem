// Mirrors backend/app/schemas.py — keep in sync.

/**
 * One coarse, IP-Composer-aligned concept extracted from an image by the
 * smart-tagging VLM. Each ConceptTag corresponds to ONE selectable handle
 * on the canvas overlay; clicking it appends/removes a CuratedConcept on
 * the fusion stack.
 *
 * - scope="local": anchor is `[x, y]` in [0,1]^2 (origin top-left).
 *   The frontend floats this pill at `imageOrigin + anchor * imageSize`,
 *   inverse-scaled so the pill stays a constant pixel size regardless of
 *   canvas zoom.
 * - scope="global": anchor is null. Concepts like lighting / style / mood
 *   that have no specific image location — rendered as edge chips on top
 *   of the image instead of anchored pins.
 */
export interface ConceptTag {
  concept: string;
  scope: "local" | "global";
  anchor: [number, number] | null;
}

/** Minimal {id,url} reference — kept for backwards-compat with code paths
 *  that don't need full Asset metadata (e.g., gallery entry source refs). */
export interface AssetRef {
  id: string;
  url: string;
}

/**
 * One slot fed into the FusionStack POST body. `dimension` carries the
 * coarse concept name (e.g. "dog", "lighting"); `tags` is a 1-element list
 * with the same string (the backend's ip_composer_client joins it with
 * ", " to form the slot's concept prompt). Kept as a 1-element list for
 * wire compatibility with the existing backend shape.
 */
export interface FusionStackConcept {
  dimension: string;
  tags: string[];
  alpha: number;
  name: string;
}

export type Sign = "+" | "-";

export interface Group {
  asset_id: string;
  sign: Sign;
  concepts: FusionStackConcept[];
}

export interface FusionStack {
  base_asset_id: string;
  groups: Group[];
  num_samples: number;
  seed: number;
}

export interface TagResult {
  asset_id: string;
  tags: ConceptTag[];
}

export interface ComposeResponse {
  result_asset_id: string;
  result_asset_ids?: string[];
  results?: ComposedAsset[];
  seed: number;
  used_mock: boolean;
  drift?: number | null;
  drift_warn?: boolean;
  weak_slots?: string[];
}

// ─── Asset discriminated union ─────────────────────────────────────────────

export type AssetOrigin = "generated" | "composed" | "lasso" | "uploaded";

interface AssetCommon {
  id: string;
  url: string;
  origin: AssetOrigin;
  createdAt: number;
  /** Auto-generated short tag for the UI: G1, R3, L1, U2 … */
  label: string;
  /** Lazily populated by Smart Tagging. */
  tags?: TagResult;
  /** Captured on first <img onLoad>; used by lasso layer to convert
   *  stage-pixel polygons → image-pixel polygons, and by the floating
   *  tag overlay to map normalized anchors → tile-relative pixels. */
  originalW?: number;
  originalH?: number;
}

export interface GeneratedAsset extends AssetCommon {
  origin: "generated";
  prompt: string;
  generator: string;
}

export interface ComposedAsset extends AssetCommon {
  origin: "composed";
  prompt: string;
  galleryEntryId: string;
  variantIdx: number;
  numSamples: number;
  seed: number;
  fusionStack: CuratedConceptSnapshot[];
  sourceAssetIds: string[];
  usedMock: boolean;
}

export interface LassoAsset extends AssetCommon {
  origin: "lasso";
  parentAssetId: string;
  polygon: [number, number][];
}

export interface UploadedAsset extends AssetCommon {
  origin: "uploaded";
  originalFilename: string;
  uploadedSizeBytes: number;
}

export type Asset =
  | GeneratedAsset
  | ComposedAsset
  | LassoAsset
  | UploadedAsset;

/**
 * Snapshot of a CuratedConcept stored on ComposedAsset / persisted in a
 * persona. With Phase 9 the smart-tagging granularity collapsed (each
 * clicked tag IS one IP-Composer concept), so `dimension` and `tag`
 * hold the SAME string — the canonical concept name. The two-field
 * shape is preserved for wire compatibility with the persona route's
 * existing JSON contract.
 */
export interface CuratedConceptSnapshot {
  assetId: string;
  /** Canonical concept name, e.g. "dog", "lighting". */
  dimension: string;
  /** Mirrors `dimension` after Phase 9. Older records may carry a
   *  distinct sub-keyword. */
  tag: string;
  sign: Sign;
  alpha: number;
}

// ─── Canvas model ──────────────────────────────────────────────────────────

export interface CanvasItem {
  assetId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
}

// ─── concept accent colors ─────────────────────────────────────────────────

/**
 * Coarse-grained accent palette keyed by canonical concept name. Falls
 * back to a neutral via `accentForConcept()` when the VLM emits a novel
 * concept outside this map (per the dynamic-dimensions memory).
 */
export const CONCEPT_COLOR: Record<string, string> = {
  // people / subjects
  person: "#ef5d6f",
  face: "#ef5d6f",
  outfit: "#f5a45d",
  pose: "#c084fc",
  expression: "#facc15",
  // animals
  dog: "#7bd88f",
  cat: "#7bd88f",
  bird: "#7bd88f",
  horse: "#7bd88f",
  animal: "#7bd88f",
  // objects / plants
  object: "#5b8def",
  subject: "#5b8def",
  vehicle: "#5b8def",
  building: "#5b8def",
  flower: "#ff8fb3",
  fruit: "#ff8fb3",
  food: "#ff8fb3",
  tree: "#7bd88f",
  plant: "#7bd88f",
  // surfaces
  fur: "#e25cc7",
  pattern: "#e25cc7",
  material: "#e25cc7",
  texture: "#e25cc7",
  // scene / globals
  scene: "#5dd4d8",
  background: "#5dd4d8",
  layout: "#5dd4d8",
  lighting: "#facc15",
  "time of day": "#facc15",
  color: "#5b8def",
  "color palette": "#5b8def",
  style: "#a3a3ff",
  mood: "#a3a3ff",
  atmosphere: "#a3a3ff",
  composition: "#c084fc",
};

export function accentForConcept(concept: string): string {
  return CONCEPT_COLOR[concept] ?? "#9aa0a6";
}

// ─── User + Persona (Phase 8) ──────────────────────────────────────────────

export interface User {
  id: string;
  name: string;
  created_at: number;
  last_seen_at: number;
}

/** Lightweight persona view used by the PersonaPanel list. */
export interface PersonaSummary {
  id: string;
  user_id: string;
  name: string;
  created_at: number;
  updated_at: number;
  last_used_at: number;
  prompt: string;
  seed: number;
  concept_count: number;
  plus_count: number;
  minus_count: number;
  asset_count: number;
  /** Tiny preview chips for the panel list. After Phase 9, `dimension`
   *  and `tag` are usually the same string (the concept name). */
  concept_preview: { dimension: string; tag: string; sign: Sign }[];
  asset_preview_ids: string[];
}

/** Full persona returned by GET /api/users/.../personas/<id>. */
export interface PersonaFull {
  id: string;
  user_id: string;
  name: string;
  created_at: number;
  updated_at: number;
  last_used_at: number;
  prompt: string;
  seed: number;
  concepts: CuratedConceptSnapshot[];
  assets: {
    id: string;
    label: string;
    origin: AssetOrigin;
    url: string;
    /** Phase 9: the new ConceptTag list shape. Older records persisted
     *  before Phase 9 store the legacy dim-keyword map here — those are
     *  treated as missing (null) on read; users can re-tag. */
    tags: ConceptTag[] | null;
    available: boolean;
  }[];
}

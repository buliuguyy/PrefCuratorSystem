// Mirrors backend/app/schemas.py — keep in sync.

export type Dimension =
  | "Color"
  | "Style"
  | "Texture"
  | "Lighting"
  | "Mood"
  | "Subject"
  | "Composition";

export const ALL_DIMENSIONS: Dimension[] = [
  "Color",
  "Style",
  "Texture",
  "Lighting",
  "Mood",
];

/** Minimal {id,url} reference — kept for backwards-compat with code paths
 *  that don't need full Asset metadata (e.g., gallery entry source refs). */
export interface AssetRef {
  id: string;
  url: string;
}

export interface Concept {
  dimension: Dimension;
  tags: string[];
  alpha: number;
  name: string;
}

export type Sign = "+" | "-";

export interface Group {
  asset_id: string;
  sign: Sign;
  concepts: Concept[];
}

export interface FusionStack {
  base_asset_id: string;
  groups: Group[];
  num_samples: number;
  seed: number;
}

export interface TagResult {
  asset_id: string;
  tags: Partial<Record<Dimension, string[]>>;
}

export interface ComposeResponse {
  /** Back-compat: single result id (Phase 1 backend). */
  result_asset_id: string;
  /** Multi-result list (mock + future backend). When present, preferred. */
  result_asset_ids?: string[];
  /** Full Asset metadata for each result (mock returns these inline). */
  results?: ComposedAsset[];
  seed: number;
  used_mock: boolean;
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
   *  stage-pixel polygons → image-pixel polygons. */
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
 * Lightweight snapshot of CuratedConcept stored on ComposedAsset — same shape
 * but without the live store key. Declared here to avoid a circular import
 * from the store file. Per-tag granularity: each curated tag is its own
 * concept (own alpha / own intensity slider).
 */
export interface CuratedConceptSnapshot {
  assetId: string;
  dimension: Dimension;
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

// ─── dimension accent colors ───────────────────────────────────────────────

export const DIMENSION_COLOR: Record<Dimension, string> = {
  Color:       "#5b8def",
  Style:       "#f5a45d",
  Texture:     "#e25cc7",
  Lighting:    "#7bd88f",
  Mood:        "#5dd4d8",
  Subject:     "#ef5d6f",
  Composition: "#c084fc",
};

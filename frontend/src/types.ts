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
  result_asset_id: string;
  seed: number;
  used_mock: boolean;
}

// Per-dimension accent colors (semantic, matches the screenshot vibe).
export const DIMENSION_COLOR: Record<Dimension, string> = {
  Color:       "#5b8def",  // blue
  Style:       "#f5a45d",  // orange
  Texture:     "#e25cc7",  // pink
  Lighting:    "#7bd88f",  // green
  Mood:        "#5dd4d8",  // teal
  Subject:     "#ef5d6f",  // red
  Composition: "#c084fc",  // purple
};

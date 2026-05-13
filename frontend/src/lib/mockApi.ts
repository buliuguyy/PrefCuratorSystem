"use client";

/**
 * Frontend-only mock implementation of the backend API.
 *
 * Activated by setting NEXT_PUBLIC_USE_MOCK_API=1 in .env.local. Mimics the
 * shape of every endpoint so `api.ts` can swap in this module without callers
 * caring. Returns plausible data, draws a client-side canvas composite for
 * compose() results, and registers fake asset ids in an in-memory map so
 * `assetUrl(id)` keeps working.
 *
 * Returns full Asset objects from generateCandidates / compose so the zustand
 * store can register them directly without round-tripping metadata.
 */

import type {
  AssetRef,
  ComposeResponse,
  ComposedAsset,
  CuratedConceptSnapshot,
  Dimension,
  FusionStack,
  GeneratedAsset,
  TagResult,
} from "@/types";

// ─── in-memory url map (for assetUrl + drawMockComposite base lookups) ─────

const assetUrls = new Map<string, string>();

function freshId(prefix = "mock"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 12)}`;
}

function registerUrl(url: string, prefix = "mock"): string {
  const id = freshId(prefix);
  assetUrls.set(id, url);
  return id;
}

// ─── fixed sample images (served by Next from /public/mock-assets) ─────────

const CANDIDATE_URLS = [
  "/mock-assets/1.png",
  "/mock-assets/2.png",
  "/mock-assets/3.png",
  "/mock-assets/4.png",
];

// ─── tag pools per dimension ───────────────────────────────────────────────

const TAG_POOLS: Record<Dimension, string[][]> = {
  Color: [
    ["warm", "glowing", "amber"],
    ["cool", "moonlit", "blue-tinted"],
    ["pastel", "soft pink", "cream"],
    ["fiery", "sunset orange", "ember"],
  ],
  Style: [
    ["fantasy", "magical realism", "painterly illustration"],
    ["gothic", "moody oil paint", "low-light cinematic"],
    ["pixel art", "cartoon", "classic video game"],
    ["dreamy concept art", "matte painting"],
  ],
  Texture: [
    ["rough wood", "thatched", "weathered stone"],
    ["smooth marble", "polished granite"],
    ["flat shaded", "low-res pixel"],
    ["billowy", "fluffy", "painterly texture"],
  ],
  Lighting: [
    ["warm candlelight", "fairy-lit", "lantern glow"],
    ["dim moonlight", "rim lighting"],
    ["bright daylight", "even diffuse"],
    ["sunset", "golden hour", "fiery backlighting"],
  ],
  Mood: [
    ["mystical", "spooky", "Halloween", "dreamy twilight"],
    ["austere", "lonely", "haunted"],
    ["cheerful", "whimsical", "playful"],
    ["serene", "majestic", "dreamlike"],
  ],
  Subject: [
    ["witch's cottage", "twisted tree"],
    ["empty corridor", "fireplace"],
    ["Victorian house", "porch swing"],
    ["cloud formations", "stone dome"],
  ],
  Composition: [
    ["centered subject", "low horizon"],
    ["one-point perspective", "leading lines"],
    ["isometric", "flat front view"],
    ["floating in clouds", "high horizon"],
  ],
};

function hash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function tagsFor(assetId: string, dimension: Dimension): string[] {
  const pool = TAG_POOLS[dimension];
  return pool[hash(`${assetId}:${dimension}`) % pool.length];
}

// ─── canvas composite renderer ─────────────────────────────────────────────

async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

async function drawMockComposite(
  stack: FusionStack,
  variantIdx: number,
  variantTotal: number,
): Promise<string> {
  const baseUrl = assetUrls.get(stack.base_asset_id);
  if (!baseUrl) throw new Error(`mock: base asset not registered: ${stack.base_asset_id}`);
  const baseImg = await loadImage(baseUrl);

  const W = 512;
  const H = 512;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("mock: 2d context unavailable");

  const scale = Math.max(W / baseImg.width, H / baseImg.height);
  const dw = baseImg.width * scale;
  const dh = baseImg.height * scale;
  ctx.drawImage(baseImg, (W - dw) / 2, (H - dh) / 2, dw, dh);

  // Tint each variant with a different hue so they're visually distinct.
  const hue = variantTotal > 1 ? (variantIdx / variantTotal) * 360 : 280;
  ctx.fillStyle = `hsla(${hue}, 60%, 18%, 0.55)`;
  ctx.fillRect(0, 0, W, H);

  type Spec = { name: string; concept: string; alpha: number };
  const specs: Spec[] = [];
  for (const g of stack.groups) {
    const signed = g.sign === "+" ? 1 : -1;
    for (const c of g.concepts) {
      specs.push({
        name: c.name,
        concept: c.tags.join(", "),
        alpha: signed * c.alpha,
      });
    }
  }

  ctx.fillStyle = "#f5a45d";
  ctx.font = "700 18px -apple-system, BlinkMacSystemFont, sans-serif";
  const title =
    variantTotal > 1
      ? `MOCK COMPOSITE  ·  variant ${variantIdx + 1}/${variantTotal}`
      : "MOCK COMPOSITE (frontend-only)";
  ctx.fillText(title, 20, 28);

  ctx.fillStyle = "#e8e8ee";
  ctx.font = "14px -apple-system, BlinkMacSystemFont, sans-serif";
  let y = 56;
  for (const spec of specs.slice(0, 14)) {
    const sign = spec.alpha >= 0 ? "+" : "−";
    const line = `  ${sign} ${spec.name}: ${spec.concept.slice(0, 38)}  (α=${Math.abs(spec.alpha).toFixed(2)})`;
    ctx.fillText(line, 20, y);
    y += 22;
  }

  ctx.font = "11px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillStyle = "#a8a8b3";
  ctx.fillText(
    `seed=${stack.seed + variantIdx}  ·  ${specs.length} slot(s)  ·  hue ${Math.round(hue)}°`,
    20,
    H - 16,
  );

  return canvas.toDataURL("image/png");
}

async function drawMockLassoCrop(
  sourceUrl: string,
  polygon: [number, number][],
): Promise<string> {
  if (polygon.length < 3) throw new Error("mock: polygon needs ≥3 vertices");
  const img = await loadImage(sourceUrl);

  // bounding box in image-pixel coords (clamped + padded slightly to match backend)
  const xs = polygon.map((p) => p[0]);
  const ys = polygon.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)) - 4);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)) - 4);
  const x1 = Math.min(img.naturalWidth, Math.ceil(Math.max(...xs)) + 4);
  const y1 = Math.min(img.naturalHeight, Math.ceil(Math.max(...ys)) + 4);
  const cw = Math.max(1, x1 - x0);
  const ch = Math.max(1, y1 - y0);

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("mock: 2d context unavailable");

  // fill with neutral gray so areas outside the polygon look identical to the
  // real backend's behavior
  ctx.fillStyle = "rgb(128,128,128)";
  ctx.fillRect(0, 0, cw, ch);

  // clip to polygon (translated into the crop's local space)
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(polygon[0][0] - x0, polygon[0][1] - y0);
  for (let i = 1; i < polygon.length; i++) {
    ctx.lineTo(polygon[i][0] - x0, polygon[i][1] - y0);
  }
  ctx.closePath();
  ctx.clip();
  // draw the source positioned so (x0,y0) lands at (0,0)
  ctx.drawImage(img, -x0, -y0);
  ctx.restore();

  return canvas.toDataURL("image/png");
}

// ─── public api ────────────────────────────────────────────────────────────

export const mockApi = {
  base: "[mock]",

  assetUrl(id: string): string {
    return assetUrls.get(id) ?? "";
  },

  async health(): Promise<{ status: string; phase: string }> {
    return { status: "ok", phase: "MOCK (frontend-only)" };
  },

  async generateCandidates(
    prompt: string,
    n: number = 4,
  ): Promise<{ candidates: (AssetRef | GeneratedAsset)[] }> {
    await new Promise((r) => setTimeout(r, 350));
    const k = Math.max(1, Math.min(n, CANDIDATE_URLS.length));
    const candidates: GeneratedAsset[] = [];
    for (let i = 0; i < k; i++) {
      const url = CANDIDATE_URLS[i];
      const id = registerUrl(url, "cand");
      candidates.push({
        id,
        url,
        origin: "generated",
        createdAt: Date.now(),
        label: "", // store assigns based on origin count
        prompt,
        generator: "mock",
      });
    }
    return { candidates };
  },

  async smartTag(
    assetId: string,
    dimensions: Dimension[],
  ): Promise<TagResult> {
    await new Promise((r) => setTimeout(r, 250));
    const tags: Partial<Record<Dimension, string[]>> = {};
    for (const d of dimensions) tags[d] = tagsFor(assetId, d);
    return { asset_id: assetId, tags };
  },

  async lasso(
    assetId: string,
    polygon: [number, number][],
    _dimensions: Dimension[],
  ): Promise<{ cropped_asset_id: string; tags: Record<Dimension, string[]> }> {
    await new Promise((r) => setTimeout(r, 300));
    const sourceUrl = assetUrls.get(assetId);
    if (!sourceUrl) throw new Error(`mock: asset not found ${assetId}`);

    // Real client-side polygon crop: load source, clip to polygon, gray-fill
    // outside (matches the backend's PIL behavior — keeps mock/real visually
    // identical), then crop to the polygon's bounding box. The polygon is in
    // image-pixel coords relative to the source's naturalWidth/Height.
    const dataUrl = await drawMockLassoCrop(sourceUrl, polygon);
    const croppedId = registerUrl(dataUrl, "lasso");

    // Lasso ROI uses a smaller, dynamic dimension set. Until the VLM is wired
    // we mock Subject + Texture + Composition as the placeholder set.
    const lassoDims: Dimension[] = ["Subject", "Texture", "Composition"];
    const tags: Partial<Record<Dimension, string[]>> = {};
    for (const d of lassoDims) {
      tags[d] = tagsFor(`${assetId}:lasso:${polygon.length}`, d);
    }
    return {
      cropped_asset_id: croppedId,
      tags: tags as Record<Dimension, string[]>,
    };
  },

  async compose(stack: FusionStack): Promise<ComposeResponse> {
    await new Promise((r) => setTimeout(r, 600));
    const n = Math.max(1, Math.min(stack.num_samples ?? 1, 4));
    const ids: string[] = [];
    const results: ComposedAsset[] = [];

    // Snapshot the fusion stack into the shape stored on composed assets.
    // The backend protocol's Concept.tags is a list, but in the new per-tag
    // model each concept carries exactly one tag — snapshot it as-is.
    const fusionSnapshot: CuratedConceptSnapshot[] = [];
    const sourceIds = new Set<string>();
    for (const g of stack.groups) {
      sourceIds.add(g.asset_id);
      for (const c of g.concepts) {
        fusionSnapshot.push({
          assetId: g.asset_id,
          dimension: c.dimension,
          tag: c.tags[0] ?? "",
          sign: g.sign,
          alpha: c.alpha,
        });
      }
    }

    for (let i = 0; i < n; i++) {
      const dataUrl = await drawMockComposite(stack, i, n);
      const id = registerUrl(dataUrl, "compose");
      ids.push(id);
      results.push({
        id,
        url: dataUrl,
        origin: "composed",
        createdAt: Date.now(),
        label: "", // store assigns
        prompt: "", // store backfills
        galleryEntryId: "", // store backfills
        variantIdx: i,
        numSamples: n,
        seed: stack.seed,
        fusionStack: fusionSnapshot,
        sourceAssetIds: [...sourceIds],
        usedMock: true,
      });
    }
    return {
      result_asset_id: ids[0],
      result_asset_ids: ids,
      results,
      seed: stack.seed,
      used_mock: true,
    };
  },
};

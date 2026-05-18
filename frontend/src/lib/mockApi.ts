"use client";

/**
 * Frontend-only mock implementation of the backend API.
 *
 * Activated by setting NEXT_PUBLIC_USE_MOCK_API=1 in .env.local. Mimics the
 * shape of every endpoint so `api.ts` can swap in this module without callers
 * caring. Returns plausible data, draws a client-side canvas composite for
 * compose() results, and registers fake asset ids in an in-memory map so
 * `assetUrl(id)` keeps working.
 */

import type {
  AssetRef,
  ComposeResponse,
  ComposedAsset,
  ConceptTag,
  CuratedConceptSnapshot,
  FusionStack,
  GeneratedAsset,
  PersonaFull,
  PersonaSummary,
  TagResult,
  UploadedAsset,
  User,
} from "@/types";

// ─── in-memory url map ─────────────────────────────────────────────────────

const assetUrls = new Map<string, string>();

// ─── mock user + persona store ─────────────────────────────────────────────

interface MockPersona {
  id: string;
  user_id: string;
  name: string;
  created_at: number;
  updated_at: number;
  last_used_at: number;
  prompt: string;
  seed: number;
  concepts: PersonaFull["concepts"];
  assets: PersonaFull["assets"];
}

const mockUsers: User[] = [];
const mockPersonas: MockPersona[] = [];

function mockSummary(p: MockPersona): PersonaSummary {
  const plus = p.concepts.filter((c) => c.sign === "+").length;
  const minus = p.concepts.filter((c) => c.sign === "-").length;
  return {
    id: p.id,
    user_id: p.user_id,
    name: p.name,
    created_at: p.created_at,
    updated_at: p.updated_at,
    last_used_at: p.last_used_at,
    prompt: p.prompt,
    seed: p.seed,
    concept_count: p.concepts.length,
    plus_count: plus,
    minus_count: minus,
    asset_count: p.assets.length,
    concept_preview: p.concepts
      .slice(0, 8)
      .map((c) => ({ dimension: c.dimension, tag: c.tag, sign: c.sign })),
    asset_preview_ids: p.assets.slice(0, 3).map((a) => a.id),
  };
}

function freshId(prefix = "mock"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 12)}`;
}

function registerUrl(url: string, prefix = "mock"): string {
  const id = freshId(prefix);
  assetUrls.set(id, url);
  return id;
}

// ─── fixed sample images ───────────────────────────────────────────────────

const CANDIDATE_URLS = [
  "/mock-assets/1.png",
  "/mock-assets/2.png",
  "/mock-assets/3.png",
  "/mock-assets/4.png",
];

// ─── mock concept sets (Phase 9: coarse, anchored) ─────────────────────────

const MOCK_CONCEPT_SETS: ConceptTag[][] = [
  [
    { concept: "dog", scope: "local", anchor: [0.5, 0.6] },
    { concept: "scene", scope: "local", anchor: [0.5, 0.2] },
    { concept: "lighting", scope: "global", anchor: null },
  ],
  [
    { concept: "object", scope: "local", anchor: [0.5, 0.55] },
    { concept: "pattern", scope: "local", anchor: [0.3, 0.5] },
    { concept: "color palette", scope: "global", anchor: null },
  ],
  [
    { concept: "person", scope: "local", anchor: [0.5, 0.5] },
    { concept: "outfit", scope: "local", anchor: [0.5, 0.72] },
    { concept: "expression", scope: "local", anchor: [0.5, 0.3] },
    { concept: "mood", scope: "global", anchor: null },
  ],
  [
    { concept: "flower", scope: "local", anchor: [0.45, 0.55] },
    { concept: "color palette", scope: "global", anchor: null },
    { concept: "lighting", scope: "global", anchor: null },
  ],
  [
    { concept: "vehicle", scope: "local", anchor: [0.5, 0.55] },
    { concept: "scene", scope: "local", anchor: [0.5, 0.3] },
    { concept: "style", scope: "global", anchor: null },
  ],
];

function hash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function tagsFor(assetId: string): ConceptTag[] {
  const set = MOCK_CONCEPT_SETS[hash(assetId) % MOCK_CONCEPT_SETS.length];
  // return a deep copy so the caller can mutate anchors without bleeding
  // into the next call
  return set.map((t) => ({
    concept: t.concept,
    scope: t.scope,
    anchor: t.anchor ? ([t.anchor[0], t.anchor[1]] as [number, number]) : null,
  }));
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

  ctx.fillStyle = "rgb(128,128,128)";
  ctx.fillRect(0, 0, cw, ch);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(polygon[0][0] - x0, polygon[0][1] - y0);
  for (let i = 1; i < polygon.length; i++) {
    ctx.lineTo(polygon[i][0] - x0, polygon[i][1] - y0);
  }
  ctx.closePath();
  ctx.clip();
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
        label: "",
        prompt,
        generator: "mock",
      });
    }
    return { candidates };
  },

  async streamCandidates(
    prompt: string,
    n: number,
    onCandidate: (a: GeneratedAsset) => void,
  ): Promise<void> {
    const k = Math.max(1, Math.min(n, CANDIDATE_URLS.length));
    for (let i = 0; i < k; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const url = CANDIDATE_URLS[i];
      const id = registerUrl(url, "cand");
      onCandidate({
        id,
        url,
        origin: "generated",
        createdAt: Date.now(),
        label: "",
        prompt,
        generator: "mock",
      });
    }
  },

  async smartTag(assetId: string, signal?: AbortSignal): Promise<TagResult> {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, 250);
      if (signal) {
        const onAbort = () => {
          clearTimeout(t);
          reject(
            typeof DOMException !== "undefined"
              ? new DOMException("aborted", "AbortError")
              : new Error("aborted"),
          );
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }
    });
    return { asset_id: assetId, tags: tagsFor(assetId) };
  },

  async lasso(
    assetId: string,
    polygon: [number, number][],
  ): Promise<{ cropped_asset_id: string; tags: ConceptTag[] }> {
    await new Promise((r) => setTimeout(r, 300));
    const sourceUrl = assetUrls.get(assetId);
    if (!sourceUrl) throw new Error(`mock: asset not found ${assetId}`);

    const dataUrl = await drawMockLassoCrop(sourceUrl, polygon);
    const croppedId = registerUrl(dataUrl, "lasso");

    // Lasso has already isolated the region — collapse anchors to center.
    const tags = tagsFor(`${assetId}:lasso:${polygon.length}`).map((t) =>
      t.scope === "local" ? { ...t, anchor: [0.5, 0.5] as [number, number] } : t,
    );
    return { cropped_asset_id: croppedId, tags };
  },

  async uploadAsset(file: File): Promise<UploadedAsset> {
    const url = URL.createObjectURL(file);
    const id = registerUrl(url, "upload");
    return {
      id,
      url,
      origin: "uploaded",
      createdAt: Date.now(),
      label: "",
      originalFilename: file.name,
      uploadedSizeBytes: file.size,
    };
  },

  async compose(stack: FusionStack): Promise<ComposeResponse> {
    await new Promise((r) => setTimeout(r, 600));
    const n = Math.max(1, Math.min(stack.num_samples ?? 1, 4));
    const ids: string[] = [];
    const results: ComposedAsset[] = [];

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
        label: "",
        prompt: "",
        galleryEntryId: "",
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

  // ─── users + personas (unchanged) ────────────────────────────────────────

  async listUsers(): Promise<User[]> {
    return [...mockUsers];
  },
  async createUser(name: string): Promise<User> {
    const nm = name.trim();
    const found = mockUsers.find(
      (u) => u.name.trim().toLowerCase() === nm.toLowerCase(),
    );
    if (found) return found;
    const now = Date.now() / 1000;
    const u: User = {
      id: freshId("u"),
      name: nm,
      created_at: now,
      last_seen_at: now,
    };
    mockUsers.push(u);
    return u;
  },
  async renameUser(userId: string, name: string): Promise<User> {
    const u = mockUsers.find((x) => x.id === userId);
    if (!u) throw new Error("user not found");
    u.name = name.trim();
    return u;
  },
  async deleteUser(userId: string): Promise<{ ok: boolean }> {
    const idx = mockUsers.findIndex((u) => u.id === userId);
    if (idx < 0) return { ok: false };
    mockUsers.splice(idx, 1);
    for (let i = mockPersonas.length - 1; i >= 0; i--) {
      if (mockPersonas[i].user_id === userId) mockPersonas.splice(i, 1);
    }
    return { ok: true };
  },
  async touchUser(userId: string): Promise<{ ok: boolean }> {
    const u = mockUsers.find((x) => x.id === userId);
    if (u) u.last_seen_at = Date.now() / 1000;
    return { ok: true };
  },

  async listPersonas(userId: string): Promise<PersonaSummary[]> {
    return mockPersonas
      .filter((p) => p.user_id === userId)
      .sort((a, b) => b.updated_at - a.updated_at)
      .map(mockSummary);
  },
  async createPersona(
    userId: string,
    payload: {
      name: string;
      concepts: PersonaFull["concepts"];
      asset_ids: string[];
      prompt: string;
      seed: number;
    },
  ): Promise<PersonaSummary> {
    const now = Date.now() / 1000;
    const p: MockPersona = {
      id: freshId("p"),
      user_id: userId,
      name: payload.name,
      created_at: now,
      updated_at: now,
      last_used_at: now,
      prompt: payload.prompt,
      seed: payload.seed,
      concepts: payload.concepts,
      assets: payload.asset_ids
        .filter((id) => assetUrls.has(id))
        .map((id) => ({
          id,
          label: "",
          origin: "generated" as const,
          url: assetUrls.get(id) ?? "",
          tags: null,
          available: true,
        })),
    };
    mockPersonas.push(p);
    return mockSummary(p);
  },
  async updatePersona(
    userId: string,
    personaId: string,
    payload: {
      name: string;
      concepts: PersonaFull["concepts"];
      asset_ids: string[];
      prompt: string;
      seed: number;
    },
  ): Promise<PersonaSummary> {
    const p = mockPersonas.find(
      (x) => x.id === personaId && x.user_id === userId,
    );
    if (!p) throw new Error("persona not found");
    const now = Date.now() / 1000;
    p.name = payload.name;
    p.prompt = payload.prompt;
    p.seed = payload.seed;
    p.concepts = payload.concepts;
    p.assets = payload.asset_ids
      .filter((id) => assetUrls.has(id))
      .map((id) => ({
        id,
        label: "",
        origin: "generated" as const,
        url: assetUrls.get(id) ?? "",
        tags: null,
        available: true,
      }));
    p.updated_at = now;
    p.last_used_at = now;
    return mockSummary(p);
  },
  async deletePersona(
    userId: string,
    personaId: string,
  ): Promise<{ ok: boolean }> {
    const idx = mockPersonas.findIndex(
      (x) => x.id === personaId && x.user_id === userId,
    );
    if (idx < 0) return { ok: false };
    mockPersonas.splice(idx, 1);
    return { ok: true };
  },
  async getPersona(userId: string, personaId: string): Promise<PersonaFull> {
    const p = mockPersonas.find(
      (x) => x.id === personaId && x.user_id === userId,
    );
    if (!p) throw new Error("persona not found");
    return {
      id: p.id,
      user_id: p.user_id,
      name: p.name,
      created_at: p.created_at,
      updated_at: p.updated_at,
      last_used_at: p.last_used_at,
      prompt: p.prompt,
      seed: p.seed,
      concepts: p.concepts,
      assets: p.assets,
    };
  },
};

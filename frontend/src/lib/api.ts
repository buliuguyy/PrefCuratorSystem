import { mockApi } from "@/lib/mockApi";
import type {
  AssetRef,
  ComposeResponse,
  Dimension,
  FusionStack,
  GeneratedAsset,
  TagResult,
} from "@/types";

const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK_API === "1";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json() as Promise<T>;
}

const realApi = {
  base: API_BASE,
  assetUrl: (id: string) => `${API_BASE}/api/assets/${id}`,
  health: () => jsonFetch<{ status: string; phase: string }>("/health"),
  generateCandidates: (prompt: string, n: number = 4) =>
    // Real backend still returns minimal AssetRef[] — the store backfills the
    // remaining GeneratedAsset fields (origin, createdAt, prompt, generator).
    jsonFetch<{ candidates: (AssetRef | GeneratedAsset)[] }>("/api/candidates", {
      method: "POST",
      body: JSON.stringify({ prompt, n }),
    }),
  smartTag: (assetId: string, dimensions: Dimension[]) =>
    jsonFetch<TagResult>("/api/tagging/smart-tag", {
      method: "POST",
      body: JSON.stringify({ asset_id: assetId, dimensions }),
    }),
  lasso: (
    assetId: string,
    polygon: [number, number][],
    dimensions: Dimension[],
  ) =>
    jsonFetch<{ cropped_asset_id: string; tags: Record<Dimension, string[]> }>(
      "/api/tagging/lasso",
      {
        method: "POST",
        body: JSON.stringify({ asset_id: assetId, polygon, dimensions }),
      },
    ),
  compose: (stack: FusionStack) =>
    jsonFetch<ComposeResponse>("/api/compose", {
      method: "POST",
      body: JSON.stringify(stack),
    }),
};

/**
 * Single api surface. Resolves at module-load based on
 * NEXT_PUBLIC_USE_MOCK_API. Components import { api } and don't know or care
 * which backend they're talking to.
 */
export const api: typeof realApi = USE_MOCK ? mockApi : realApi;

export const API_MODE: "mock" | "real" = USE_MOCK ? "mock" : "real";

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

interface RawCandidate {
  id: string;
  url: string;
  prompt?: string;
  generator?: string;
}

const realApi = {
  base: API_BASE,
  assetUrl: (id: string) => `${API_BASE}/api/assets/${id}`,
  health: () => jsonFetch<{ status: string; phase: string }>("/health"),
  generateCandidates: async (
    prompt: string,
    n: number = 4,
  ): Promise<{ candidates: (AssetRef | GeneratedAsset)[] }> => {
    const res = await jsonFetch<{ candidates: RawCandidate[] }>(
      "/api/candidates",
      {
        method: "POST",
        body: JSON.stringify({ prompt, n }),
      },
    );
    // Backfill the full GeneratedAsset shape so the store doesn't have to
    // know about backend response variants. Use the per-variant prompt the
    // backend rewrote with the prompt-expander (falls back to the user's
    // raw prompt if the backend didn't surface one).
    const candidates: GeneratedAsset[] = res.candidates.map((c) => ({
      id: c.id,
      url: `${API_BASE}${c.url}`,
      origin: "generated" as const,
      createdAt: Date.now(),
      label: "",
      prompt: c.prompt ?? prompt,
      generator: c.generator ?? "backend",
    }));
    return { candidates };
  },
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

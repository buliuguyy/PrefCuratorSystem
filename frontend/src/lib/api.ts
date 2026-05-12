import type {
  AssetRef,
  ComposeResponse,
  Dimension,
  FusionStack,
  TagResult,
} from "@/types";

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

export const api = {
  base: API_BASE,

  assetUrl(id: string): string {
    return `${API_BASE}/api/assets/${id}`;
  },

  async health(): Promise<{ status: string; phase: string }> {
    return jsonFetch("/health");
  },

  async generateCandidates(
    prompt: string,
    n: number = 4,
  ): Promise<{ candidates: AssetRef[] }> {
    return jsonFetch("/api/candidates", {
      method: "POST",
      body: JSON.stringify({ prompt, n }),
    });
  },

  async smartTag(
    assetId: string,
    dimensions: Dimension[],
  ): Promise<TagResult> {
    return jsonFetch("/api/tagging/smart-tag", {
      method: "POST",
      body: JSON.stringify({ asset_id: assetId, dimensions }),
    });
  },

  async lasso(
    assetId: string,
    polygon: [number, number][],
    dimensions: Dimension[],
  ): Promise<{ cropped_asset_id: string; tags: Record<Dimension, string[]> }> {
    return jsonFetch("/api/tagging/lasso", {
      method: "POST",
      body: JSON.stringify({
        asset_id: assetId,
        polygon,
        dimensions,
      }),
    });
  },

  async compose(stack: FusionStack): Promise<ComposeResponse> {
    return jsonFetch("/api/compose", {
      method: "POST",
      body: JSON.stringify(stack),
    });
  },
};

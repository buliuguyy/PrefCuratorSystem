import { mockApi } from "@/lib/mockApi";
import type {
  AssetRef,
  ComposeResponse,
  ConceptTag,
  FusionStack,
  GeneratedAsset,
  PersonaFull,
  PersonaSummary,
  TagResult,
  UploadedAsset,
  User,
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

async function streamNdjson(
  path: string,
  body: unknown,
  onLine: (line: Record<string, unknown>) => void,
): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const text = res.body ? await res.text() : "";
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        onLine(JSON.parse(line));
      } catch {
        /* skip malformed line, keep streaming */
      }
    }
  }
  // flush trailing line if the stream ended without a terminating \n
  const tail = buf.trim();
  if (tail) {
    try {
      onLine(JSON.parse(tail));
    } catch {
      /* ignore */
    }
  }
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
  streamCandidates: async (
    prompt: string,
    n: number,
    onCandidate: (a: GeneratedAsset) => void,
  ): Promise<void> => {
    await streamNdjson("/api/candidates/stream", { prompt, n }, (line) => {
      if (line.type !== "candidate") return;
      const c = line as unknown as RawCandidate;
      onCandidate({
        id: c.id,
        url: `${API_BASE}${c.url}`,
        origin: "generated",
        createdAt: Date.now(),
        label: "",
        prompt: c.prompt ?? prompt,
        generator: c.generator ?? "backend",
      });
    });
  },
  smartTag: (assetId: string, signal?: AbortSignal) =>
    jsonFetch<TagResult>("/api/tagging/smart-tag", {
      method: "POST",
      body: JSON.stringify({ asset_id: assetId }),
      signal,
    }),
  lasso: (assetId: string, polygon: [number, number][]) =>
    jsonFetch<{ cropped_asset_id: string; tags: ConceptTag[] }>(
      "/api/tagging/lasso",
      {
        method: "POST",
        body: JSON.stringify({ asset_id: assetId, polygon }),
      },
    ),
  compose: (stack: FusionStack) =>
    jsonFetch<ComposeResponse>("/api/compose", {
      method: "POST",
      body: JSON.stringify(stack),
    }),
  uploadAsset: async (file: File): Promise<UploadedAsset> => {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch(`${API_BASE}/api/assets/upload`, {
      method: "POST",
      body: fd,
    });
    if (!r.ok) {
      throw new Error(`${r.status} ${r.statusText}: ${await r.text()}`);
    }
    const ref = (await r.json()) as { id: string; url: string };
    return {
      id: ref.id,
      url: `${API_BASE}${ref.url}`,
      origin: "uploaded",
      createdAt: Date.now(),
      label: "",
      originalFilename: file.name,
      uploadedSizeBytes: file.size,
    };
  },

  // ─── users + personas (Phase 8) ──────────────────────────────────────────
  listUsers: () =>
    jsonFetch<{ users: User[] }>("/api/users").then((r) => r.users),
  createUser: (name: string) =>
    jsonFetch<User>("/api/users", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  renameUser: (userId: string, name: string) =>
    jsonFetch<User>(`/api/users/${userId}`, {
      method: "PUT",
      body: JSON.stringify({ name }),
    }),
  deleteUser: (userId: string) =>
    jsonFetch<{ ok: boolean }>(`/api/users/${userId}`, { method: "DELETE" }),
  touchUser: (userId: string) =>
    jsonFetch<{ ok: boolean }>(`/api/users/${userId}/touch`, { method: "POST" }),

  listPersonas: (userId: string) =>
    jsonFetch<{ personas: PersonaSummary[] }>(
      `/api/users/${userId}/personas`,
    ).then((r) => r.personas),
  createPersona: (
    userId: string,
    payload: {
      name: string;
      concepts: PersonaFull["concepts"];
      asset_ids: string[];
      prompt: string;
      seed: number;
    },
  ) =>
    jsonFetch<PersonaSummary>(`/api/users/${userId}/personas`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updatePersona: (
    userId: string,
    personaId: string,
    payload: {
      name: string;
      concepts: PersonaFull["concepts"];
      asset_ids: string[];
      prompt: string;
      seed: number;
    },
  ) =>
    jsonFetch<PersonaSummary>(`/api/users/${userId}/personas/${personaId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deletePersona: (userId: string, personaId: string) =>
    jsonFetch<{ ok: boolean }>(
      `/api/users/${userId}/personas/${personaId}`,
      { method: "DELETE" },
    ),
  getPersona: (userId: string, personaId: string) =>
    jsonFetch<PersonaFull>(`/api/users/${userId}/personas/${personaId}`),
};

/**
 * Single api surface. Resolves at module-load based on
 * NEXT_PUBLIC_USE_MOCK_API. Components import { api } and don't know or care
 * which backend they're talking to.
 */
export const api: typeof realApi = USE_MOCK ? mockApi : realApi;

export const API_MODE: "mock" | "real" = USE_MOCK ? "mock" : "real";

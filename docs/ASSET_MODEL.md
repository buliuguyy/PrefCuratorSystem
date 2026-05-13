# Asset & Canvas Model

The frontend treats every image inside a session as a typed **Asset**. Assets
are the single source of truth for everything: thumbnails in the Fusion Stack,
tiles on the Canvas, slider thumbnails in the Refiner, the cover image in the
Gallery — all read from the same `assets: Record<id, Asset>` registry on the
zustand store.

## Discriminated union

```ts
type AssetOrigin = "generated" | "composed" | "lasso" | "uploaded";

interface AssetCommon {
  id: string;            // unique within a session
  url: string;           // /mock-assets/N.png · data:... · /api/assets/{id}
  origin: AssetOrigin;
  createdAt: number;     // Date.now()
  label: string;         // auto-generated short tag for UI: G1, R3, L1, U2
  tags?: TagResult;      // VLM smart-tag result (lazy — runs first time the
                         // user opens the SmartTagPopover for this asset)
}

interface GeneratedAsset extends AssetCommon {
  origin: "generated";
  prompt: string;        // the prompt that produced it
  generator: string;     // "mock" | "gpt-image-1" | "flux-dev" | ...
}

interface ComposedAsset extends AssetCommon {
  origin: "composed";
  prompt: string;        // session prompt at compose time
  galleryEntryId: string;
  variantIdx: number;    // 0 .. numSamples-1
  numSamples: number;
  seed: number;
  fusionStack: CuratedConcept[];  // exact stack + alphas at compose time
  sourceAssetIds: string[];       // unique parent asset ids
  usedMock: boolean;
}

interface LassoAsset extends AssetCommon {
  origin: "lasso";       // (Phase 4 placeholder type)
  parentAssetId: string;
  polygon: [number, number][];
}

interface UploadedAsset extends AssetCommon {
  origin: "uploaded";    // (Future placeholder type)
  originalFilename: string;
  uploadedSizeBytes: number;
}

type Asset =
  | GeneratedAsset
  | ComposedAsset
  | LassoAsset
  | UploadedAsset;
```

## Why a discriminated union (not a flat record)?

- Pattern-matching on `origin` lets TS narrow which fields are present.
- Each origin has its OWN required metadata; flattening would force
  `composed`-only fields like `fusionStack` to be nullable on every asset,
  which lies about the data and grows test surface.
- Adds a place to hang origin-specific UI (badge, hover tooltip, action
  affordance) without scattering `if (asset.something_specific)` checks.

## Label rules

| Origin | Pattern | Example |
|---|---|---|
| `generated` | `G{n}` where n is creation order among generated | `G1`, `G2`, …, `G8` |
| `composed`  | `R{n}` where n is creation order among composed | `R1`, `R2`, …, `R5` |
| `lasso`     | `L{n}`                                          | `L1` |
| `uploaded`  | `U{n}`                                          | `U1` |

The label is computed when the asset is first registered and frozen. The
counters reset per `setPrompt + clearCanvas` (i.e., when the designer starts
a fresh session).

## Canvas model

Items on the canvas are positioned tiles backed by an asset:

```ts
interface CanvasItem {
  assetId: string;
  x: number;       // canvas-space coordinates (not viewport)
  y: number;
  width: number;   // designer can later resize (future)
  height: number;
  z: number;       // last-touched goes on top
}

interface CanvasViewport {
  panX: number;
  panY: number;
  // (zoom deferred — Phase 4+)
}
```

### Auto-layout policy

- **Initial generate** (4 candidates): 2×2 grid centered in the visible
  canvas viewport.
- **Subsequent generate**: new tiles spawned in the next available row below
  existing tiles (linear column-wrap from left).
- **Compose** (1–4 variants): variants spawned in a row directly below the
  most-recent existing row, slightly inset right. Visually distinct (purple
  border + ✦ badge) so they're recognizable as composed.

The designer can drag any tile to any position; auto-layout never moves a
tile after the designer has touched it.

## Storage strategy (mock mode)

- Asset registry: `useCurator.state.assets: Record<id, Asset>` — single
  source of truth.
- For composed mock results, `url` is a `data:image/png;base64,...` URL,
  produced client-side via canvas drawing. No backend involved.
- For generated mock candidates, `url` is `/mock-assets/{1..4}.png` served
  by Next from `public/`.
- The mock API still maintains its own URL Map internally for `drawMockComposite`'s
  base-image lookup (so it can crossOrigin-load a candidate when compositing).
  This is duplicated from the store's `asset.url`, but it's bounded and
  contained to `mockApi.ts`.

## Storage strategy (real backend mode — future)

When the real backend is wired:

- POST `/api/candidates` → backend returns asset ids + minimal metadata;
  frontend stores Asset objects with `url = ${API_BASE}/api/assets/{id}`.
- POST `/api/compose` → backend returns asset ids; same pattern.
- `tags` are populated lazily via POST `/api/tagging/smart-tag` and persisted
  on the Asset object.

The backend needs to durably store:

1. The bytes of every asset (already partially in `backend/app/storage.py`,
   currently in-memory)
2. The Asset metadata (currently lost on server restart). Plan: add a small
   sqlite or JSON sidecar keyed by asset id.

Until durable storage lands, assets live for the duration of the session
only. Persona save/load (Phase 6) will need to either:
  - snapshot referenced asset bytes into the persona JSON, OR
  - lean on durable backend storage

## Smart Tagging applies uniformly

Any asset — generated, composed, lasso, uploaded — can be tagged via the
SmartTagPopover. Clicking a tile on the Canvas opens the popover scoped to
that asset.

For **composed** assets specifically: the popover's tag suggestions come
from the VLM examining the composed image, not from a re-aggregation of
the source stack's tags. This way the designer can iterate on emergent
features that didn't exist in any individual source.

## Composed → next compose chain

Because composed assets are first-class registered assets, the designer can:

1. Pick a composed image in the Canvas
2. Smart-tag it
3. Like/dislike tags → those concepts enter the Fusion Stack
4. Click Compose → the new compose call lists the composed asset id as one
   of its `sourceAssetIds`

The store's `compose()` action handles this transparently — no special-casing
for "is the source a composed asset". The backend (real IP-Composer) likewise
treats every asset as an image; it doesn't care how the bytes were produced.

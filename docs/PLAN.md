# PrefCurator — Phase Plan

Living document. Updated as decisions evolve.

## Working strategy

**Frontend-first, mock-first.** All UI flows are wired end-to-end using a
client-side mock API (`frontend/src/lib/mockApi.ts`) — no backend calls
during UI iteration. Once every panel and interaction is locked, we swap in
real backend algorithms one at a time.

The toggle is `NEXT_PUBLIC_USE_MOCK_API=1` in `frontend/.env.local`. Setting
it to `0` (or removing it) makes `api.ts` hit the FastAPI backend instead.

## Phase ledger

### ✅ Phase 0 — scaffold
Repo skeleton + dev servers boot. Commit `2b50d3b`.

### ✅ Phase 1 — backend service clients + routes (all mock)
`image_gen_client` / `vlm_tagger_client` / `ip_composer_client` + 5 routes +
pytest smoke. Commit `bef2a18`.

### ✅ Phase 2 — Inspiration Grid + Smart Tag popover (frontend)
`Topbar`, `InspirationGrid`, `SmartTagPopover`, `FusionStackPreview`,
zustand store with `toFusionStack()`. Commit `d57a5e6`.

### ✅ Phase 2.5 — per-tag selection refinement
Each individual tag is independently like/dislike-able (not the whole
dimension row). Backend mock candidates use the user's 4 real placeholder
images. Commit `1156771`.

### 🚧 Phase 3 — Compose pipeline (mock-only frontend)
- `Compose` button in Fusion Stack panel header
- `ResultCanvas` swap-view (back / recompose)
- `IntensityMixer` panel appears at the bottom **after first compose**
  (folding the previously-planned Phase 5 panel into this phase per
  user spec)
- Mock-fallback banner kept (also useful when real backend is wired)
- **No real backend calls in this phase** — `mockApi.ts` returns a
  client-rendered composite image (canvas with slot overlay) so the UI
  flow is fully demoable offline

### ✅ Phase 4 — Lasso (free-draw polygon ROI)
- Right-click any tile → context menu → "Lasso this image" enters draw mode
- SVG drawing overlay (deviated from `react-konva` — single polyline + handles
  was materially simpler as plain SVG; konva stays in deps for future brush
  masks). Click drops vertices · drag freehands · close by clicking near v0,
  pressing Enter, or double-clicking · Esc cancels.
- On commit: `api.lasso(parent, polygon, [])` returns `cropped_asset_id` + tags.
  The mock `lasso()` now does a real client-side polygon crop (gray-fill outside
  the polygon, matching backend PIL behavior) so the offline demo is faithful.
- New `LassoAsset` registers as its own tile on the canvas next to its parent;
  `SmartTagPopover` auto-opens on the new asset.
- `PolygonOverlay` renders a persistent dashed polygon + L-label callout inside
  `.world` on the parent tile (inverse-scaled stroke so dashes stay visually
  constant at any zoom). Clicking the polygon re-opens its SmartTagPopover.
- `SmartTagPopover` now iterates `Object.entries(data.tags)` — dimensions are
  whatever the API returns (resolves outstanding design decision below).
- **Bonus mid-phase add (per user request):** Feature Fusion Stack is now
  drag-reorderable. The asset of the FIRST positive (`+`) concept in the
  stack becomes `base_asset_id` in the compose payload (replacing the prior
  most-positive-count heuristic). A "BASE" badge marks which row is currently
  driving the base image.
  Commit `<pending>`.

### Phase 5 — Intensity sliders → real recompose
- Slider drag (debounced 200ms) → recompose with adjusted alphas
- Same `seed` preserves overall composition
- "Mixer Group" lock UI: select multiple sliders → drag in unison
  (preserve ratios), per the screenshot's `Locked` chip
- Until backend is wired, slider changes only update the mock composite
  visually

### Phase 6 — Persona panel + real backend algorithms
- Left sidebar `PersonaPanel`: "Idiosyncratic Preferences" with persona
  cards (name + tag flat-list, color-coded by dimension)
- "Save as Persona" / "Update Persona" / "Load Persona"
- "Asset Library" panel (also left sidebar)
- "The Curator Panel" right sidebar w/ Version History + Final Composition
- Backend algorithm wire-up (one at a time):
  1. **ImageTagging** (VLM, currently mocked in `vlm_tagger_client`):
     upload image → structured JSON of feature words per dimension.
     Real impl uses GPT-5.4 via OPENAI_BASE_URL.
  2. **IP-Composer integration**: forward fusion stack to localhost:12100;
     debug CORS error path (currently FastAPI 500 on compose path masks as
     CORS — the middleware doesn't add headers when an unhandled exception
     short-circuits the response. Need to add a global exception handler
     that wraps errors into 4xx/5xx with CORS headers preserved.)
  3. **TextToImage** for initial candidates (currently mocked with the 4
     user-uploaded placeholders). Provider TBD.

## Outstanding design decisions (track here)

- [ ] How does "Asset Library" relate to candidates? Are dropped/uploaded
  images allowed in the library independent of the prompt-generated grid?
- [x] **Resolved (Phase 4):** Lasso ROI tagging dimensions — popover renders
  whatever dimensions the API returns (dynamic per-image, future VLM-driven).
  Mock returns `Subject + Texture + Composition` for ROIs. Same dynamic-iter
  pattern is also used by the full-image SmartTagPopover.
- [ ] Mixer Group "Locked" semantics: what's the unlocked default? Each
  slider independent, or all sliders move together by default?
- [ ] Persona schema: persistent UUIDs vs. user-given names? Versioning?

## Naming map (screenshot terminology → code)

- "Idiosyncratic Preferences" → left-sidebar `PersonaPanel` (Phase 6)
- "Asset Library" → bottom of `PersonaPanel` (Phase 6)
- "Smart Tagging" → `SmartTagPopover` (Phase 2)
- "Feature Fusion Stack" / "Curator Tiles" → `FusionStackPreview` (Phase 2,
  to be promoted to `FeatureFusionStack` panel in Phase 3 with the
  "Result image = A_features + D_Lasso − B_style" formula header)
- "Feature Intensity Mixer" → `IntensityMixer` (Phase 3 mocked / Phase 5
  real)
- "The Curator Panel" with "Version History" / "Final Composition" → Phase 6
- "Save as Persona" / "Update Persona" → Phase 6

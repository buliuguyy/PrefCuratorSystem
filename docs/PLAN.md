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

### ✅ Phase 6a — VLM smart-tag (real)
GPT-5.4-mini via OPENAI_BASE_URL with the curator prompt; tolerant parser
handles novel dimension names. Mock fallback preserved for offline dev.

### ✅ Phase 6b — Initial image generation (real)
- `prompt_expander_client`: GPT-mini rewrites the user prompt into N
  variants that diverge on aesthetic dimensions the prompt didn't pin
  (style / lighting / mood / palette / texture / composition / atmosphere).
  System prompt enforces ≥2-dim divergence per pair and keeps user-pinned
  dimensions fixed.
- `gemini_image_client`: raw httpx call to `gemini-3-pro-image-preview`
  via the nuwaflux proxy (`https://api.nuwaflux.com`). Parses both
  `inlineData` and base64-data-URL-in-text response shapes.
- `image_gen_client.generate_candidates` is now async: expand → fan out
  Gemini calls concurrently → per-slot fallback to temp_assets or
  synthetic gradient on any failure. Each candidate carries its variant
  prompt + which generator produced it; surfaced to the frontend through
  `CandidateAsset.{prompt, generator}` and stored on `GeneratedAsset`.
- `SmartTagPopover` now enforces a 400ms minimum spinner duration so the
  "extracting semantic features…" state is always visible, even when the
  backend returns near-instantly (fixes prior UX gap where tags appeared
  instantly on assets whose preview hadn't rendered).

### ✅ Phase 6c — IP-Composer (real)
- `ip_composer_client.compose()` now does the full two-hop protocol with
  the Flask IP-Composer at `localhost:12100`: multipart POST `/compose`
  → parse JSON `{urls, files, drift, drift_warn, slots[*].signal_ratio}`
  → follow up with `GET /outputs/<fn>` per sample to pull PNG bytes →
  store each into AssetStore as its own asset.
- Mock fallback retained: triggers on ConnectError, ReadTimeout, 4xx/5xx
  or malformed response. Now also logs the IP-Composer body preview so
  the real cause (e.g. an LLM auto-gen 500 inside IP-Composer) is
  surfaced in backend logs, not silently swallowed.
- `ComposeResponse` extended with `result_asset_ids: list[str]` (always
  ≥1, supports `num_samples > 1`), `drift`, `drift_warn`, `weak_slots`.
  `result_asset_id` is kept for back-compat = `result_asset_ids[0]`.
- Frontend: yellow drift banner above the result when `drift > 0.6`;
  per-row "weak ref" chip in FusionStackPreview when the concept slot's
  `signal_ratio < 0.10` (mirroring the slot-name format from
  `toFusionStack`).
- Known issue (out of scope for 6c): free-form tag strings IP-Composer
  hasn't seen trigger its LLM auto-gen path, which can 500 on rate-limit
  / nuwaflux upstream. First compose against a fresh tag may fall back
  to mock; subsequent calls hit IP-Composer's local NPY cache.

### ✅ Phase 7 — UX polish + perf (post-6c)
Bundled cleanup pass after real backends came online. Bullets below
are individual commits so they can be reviewed / reverted in isolation.

- **7.1 Smart Tag latency** — `next.config.ts` ships with
  `reactStrictMode: true`, which double-invokes the popover's
  effect → two VLM round-trips per open. The 400ms minimum-spinner
  guard then masked the win when it was added in Phase 6b. Fix:
  `AbortController` so the cancelled effect actually kills its
  request, and drop the artificial floor to 120ms so a cache hit
  feels instant.
- **7.2 Floating, non-modal popover** — `SmartTagPopover` is currently
  a center-of-screen modal with a dimmed backdrop, blocking the
  canvas. Convert to a draggable floating panel anchored to the
  top-right, no backdrop, so the user can pan / lasso / reorder the
  Fusion Stack while a popover is open.
- **7.3 Pre-tag generated candidates** — after `generate()`, fire
  `api.smartTag` in the background for each new generated asset and
  stash into `assets[id].tags`. Click-to-open then renders from the
  cache, no waterfall. (Recomposed images stay click-driven per user
  spec — they're the user's destination, not exploration material.)
- **7.4 Per-tile download** — right-click → "Save to local" in the
  tile context menu. Uses the asset URL via `fetch` + Blob anchor
  trick so the filename + content-type are correct.
- **7.5 Mac keyboard pan / zoom** — `Canvas` only listens to
  pointer/wheel today. Add `keydown` handlers: arrow keys pan
  (Shift = larger step), `+` / `-` / `=` zoom, `0` reset. Listener
  guards against typing in inputs/textareas.
- **7.6 Stream candidates one-by-one** — `/api/candidates` currently
  awaits the full `asyncio.gather`. Add a sibling streaming route
  `/api/candidates/stream` that emits one NDJSON line per finished
  Gemini call; frontend reads with `fetch().body.getReader()` and
  registers each candidate the moment it lands. Old endpoint stays
  for the mock path.
- **7.7 Mac trackpad horizontal pan** — wheel handler was ignoring
  `deltaX`, so two-finger horizontal swipe did nothing. Now honors
  both axes; `Shift+wheel` still maps vertical-only mice to horizontal
  pan.
- **7.8 Image upload** — `Upload` button right of the prompt input.
  Reuses the existing `POST /api/assets/upload` endpoint; uploaded
  files register as `origin: "uploaded"` assets that share the same
  canvas tile + pre-tag pipeline as generated candidates (so test
  flows don't have to repeatedly generate).
- **7.9 Interaction redesign — preview vs. tag** — left-click on a
  tile now opens a centered `PreviewOverlay` (large image, no controls).
  Tag / Lasso / Save moved into the tile's right-click menu. The Tag
  entry shows an animated "Tagging…" label while pre-tag is in flight
  (per-asset `taggingAssets` flag in the store); clicking it still opens
  `SmartTagPopover`, which now skips its own fetch when pre-tag has
  the slot — eliminating the race where a user-click duplicated the
  pre-tag's VLM request.
- **7.10 Direct-OpenAI path + local HTTP proxy** — the nuwaflux proxy
  was returning 524 / 429 on concurrent VLM bursts (3 of 4 pre-tag
  calls per Generate would time out). Settings now expose
  `raw_openai_*` fields (`api_key`, `base_url`, `proxy`) consumed by
  the VLM + prompt-expander clients; Gemini and IP-Composer are
  unchanged. The `raw_` prefix is deliberate — guarantees no
  inadvertent inheritance from a stray `OPENAI_BASE_URL` env var in
  the shell. When `RAW_OPENAI_PROXY` is set (e.g.
  `http://127.0.0.1:6152` for our network-restricted Linux box),
  every direct-OpenAI httpx client tunnels through it.

### ✅ Phase 8 — Persona panel + Asset Library + Curator panel
(was the long-deferred "Phase 6d"; renumbered as Phase 8 now that 7 is
in. Single biggest remaining UI surface.)

**Shipped.** Per-user idiosyncratic preference profile that loads and
auto-updates as the user designs.

- Backend: `backend/app/persona_store.py` + `backend/app/routes/personas.py`.
  Disk-backed JSON under `backend/storage/{users.json, personas/<user_id>/<pid>.json}`.
  Persona records embed source-asset bytes as base64 so applying a saved
  persona on a fresh canvas (or after a server restart) re-hydrates the
  AssetStore with the original ids — the existing `/api/assets/<id>`
  endpoint then serves the bytes back unchanged. Endpoints:
  `GET/POST/PUT/DELETE /api/users`, `POST /api/users/<id>/touch`,
  `GET/POST/PUT/DELETE /api/users/<id>/personas[/...]`,
  `GET /api/users/<id>/personas/<id>` (hydrates → returns metadata only).
- Frontend: `User`, `PersonaSummary`, `PersonaFull` types + matching
  `api.ts` / `mockApi.ts` surface. Zustand store gains
  `users`, `currentUserId`, `personas`, `activePersonaId`,
  `personasLoading`, `personaError`, `finalAssetId` + actions for each.
- Topbar `UserSwitcher` chip — no-password "sign-in" by display name.
  Last-used user id stored in `prefcurator/last-user-id/v1`; last-active
  persona per user under `prefcurator/last-active-persona-id/v1/<uid>`.
  Final-asset pin per user under `prefcurator/final-asset/<uid>`.
- `PersonaPanel` (left top): active-persona banner with detach button,
  "Save current as persona" entry, list of per-user persona cards with
  thumbnail strip, color-coded dim/tag chips, +/- counts, seed, and
  per-card Apply / Update / Delete.
- `AssetLibrary` (left bottom): filterable grid (All / Gen / Upload /
  Lasso / Result) over every asset in `useCurator.assets`. Left-click →
  PreviewOverlay; right-click → Smart tag / Lasso / Save / Pin-as-final
  (reuses the canvas-tile context-menu actions). Final-pinned cells get
  a yellow border + FINAL badge.
- `CuratorPanel` (right): Version History (the panel's top half — what
  ResultGallery used to do, now richer) + Final Composition slot (bottom
  half, fed by Pin-as-final from canvas / library / gallery row).
- **"Active persona" semantic = the user's evolving design preference
  signature.** Every successful `compose()` fires
  `autoUpdateActivePersona()` (fire-and-forget) which overwrites the
  persona's concepts + asset snapshots with the latest stack — so a
  persona accumulates the user's design behavior across a session
  rather than being a one-shot snapshot. Applying a persona makes it
  the new active one; "Detach" stops auto-snapshotting until the user
  applies another.
- Layout: switched to 4 columns. PersonaPanel + AssetLibrary on the
  left (replacing the old left-side `ResultGallery`, now deleted as
  dead code), Canvas/Refiner center, FusionStackPreview, CuratorPanel.

**Left sidebar — `PersonaPanel` ("Idiosyncratic Preferences")**
- Persona cards: each card = a saved `CuratedConcept[]` snapshot of the
  stack, color-coded chips per dimension (reuse `DIMENSION_COLOR`).
- Actions per card: Apply (replace current stack), Update (overwrite
  from current stack), Rename, Delete. Active persona gets the accent
  border.
- "Save as Persona" entry at the top of the panel — pops a small name
  prompt, stashes the current `useCurator.stack` into a new persona.
- Storage: localStorage v0 (versioned key `prefcurator/personas/v1`,
  JSON-serialised). Defer Redis / DB until we know the schema is stable.

**Left sidebar — `AssetLibrary` (beneath PersonaPanel)**
- Lists every Asset currently in `useCurator.assets` regardless of how
  it landed there (generated / uploaded / lasso / composed), filterable
  by origin.
- Click → opens the same PreviewOverlay used by canvas tiles.
- Right-click → same context menu (Smart tag / Lasso / Save). Reuse
  the Canvas tile context menu component (factor it out).
- Visual: thumbnail grid (~72×72), origin badge in the corner,
  hover-tooltip with full label.

**Right sidebar — `CuratorPanel` ("The Curator Panel")**
- Top half: Version History (= `useCurator.gallery`). One row per
  compose call: thumb of `resultAssetIds[selectedResultIdx]`, prompt
  preview, "Restore" button → `loadGalleryEntry(id)`.
- Bottom half: Final Composition pinning. Right-click on a gallery
  entry / a canvas tile → "Pin as final" → stores `finalAssetId` in
  the store + renders large in this slot. Distinct from version
  history because there's exactly one "final".

**Out-of-scope for Phase 8** (call out so we don't scope-creep):
- Persona import/export (file). Defer.
- Diff between two personas. Defer.
- Multi-user / cloud sync. Defer.

### Phase 5 — Intensity sliders → real recompose
*Independent track, can be tackled before/after Phase 8.*
- Slider drag (debounced 200ms) → `compose()` with adjusted alphas.
- Same `seed` preserves overall composition so the slider feels like
  it's moving through a continuous space, not regenerating.
- "Mixer Group" lock UI: select multiple sliders → drag in unison
  (preserve ratios), per the screenshot's `Locked` chip.
- Backend already supports per-concept alpha; only the frontend
  IntensityMixer wiring is missing.

### Phase 9 (tentative) — productionization wrap-up
*Sketch only; nail down after Phase 8 lands.*
- Replace in-memory `AssetStore` with disk-backed cache (so a server
  restart doesn't kill the active canvas).
- Persona schema versioning + migration path (see open Q below).
- Error-state UX: surface drift / weak_slots / fallback-to-mock more
  prominently than the current banner.
- Auth — at minimum, a per-browser session id so multiple users on
  the same backend don't see each other's AssetStore.

## Outstanding design decisions (track here)

- [x] **Resolved (Phase 7.8):** Asset Library scope — uploaded files
  are first-class `origin: "uploaded"` assets sharing the canvas-tile +
  pre-tag pipeline with generated candidates. The library will simply
  list every entry in `useCurator.assets`, filtered by origin.
- [x] **Resolved (Phase 4):** Lasso ROI tagging dimensions — popover
  renders whatever dimensions the API returns (dynamic per-image,
  VLM-driven). Mock returns `Subject + Texture + Composition` for
  ROIs. Same dynamic-iter pattern is used by the full-image popover.
- [ ] Mixer Group "Locked" semantics (Phase 5): what's the unlocked
  default? Each slider independent, or all sliders move together by
  default?
- [x] **Resolved (Phase 8):** Persona schema — UUID `id` is the stable
  identifier, `name` is user-editable. Records snapshot **both** the
  `dimension/tag/sign/alpha` quadruples AND the source asset bytes
  (base64) so applying a persona always restores the original images.
  No schema-version field yet (small surface, single in-tree consumer);
  add when we need a v2.
- [x] **Resolved (Phase 8):** PersonaPanel apply semantics — Apply is
  destructive on the stack (replaces with the persona's snapshot) and
  registers any missing referenced assets onto the canvas (existing
  ones are left in place). Becomes the new active persona, which means
  the next compose auto-overwrites it. Use "Save as new persona" to
  fork, or "Detach" to stop auto-tracking.
- [ ] Composed-asset tagging policy (re-confirm): pre-tag stays
  click-driven per Phase 7.3 spec, but should there be an explicit
  "re-tag this composed image" affordance? (Click no longer auto-tags
  post-Phase 7.9, so this is the only path to refresh tags on a
  composed result.)

## Naming map (screenshot terminology → code)

- "Idiosyncratic Preferences" → left-sidebar `PersonaPanel` (Phase 8 ✅)
- "Asset Library" → left sidebar, beneath `PersonaPanel` (Phase 8 ✅)
- "Smart Tagging" → `SmartTagPopover` (Phase 2, refactored in Phase 7.2 / 7.9)
- "Feature Fusion Stack" / "Curator Tiles" → `FusionStackPreview` (Phase 2,
  promoted to `FeatureFusionStack` panel in Phase 3 with the
  "Result image = A_features + D_Lasso − B_style" formula header)
- "Feature Intensity Mixer" → `IntensityMixer` (Phase 3 mocked / Phase 5
  real)
- "The Curator Panel" with "Version History" / "Final Composition" → `CuratorPanel` (Phase 8 ✅)
- "Save as Persona" / "Update Persona" → top of `PersonaPanel` + per-card buttons (Phase 8 ✅)

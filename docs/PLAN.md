# PrefCurator — Phase Plan

Living document. Each phase is independently demoable; phase boundaries are
the natural commit/push points (see [commit policy in memory]).

## ✅ Phase 0 — scaffold

Repo skeleton, dev servers boot, `/health` end-to-end.
**Commit:** `2b50d3b`

## ✅ Phase 1 — backend service clients + routes (all mock)

- `image_gen_client` (mock 4 PNGs), `vlm_tagger_client` (hardcoded tags),
  `ip_composer_client` (real multipart + mock fallback when 12100 down)
- Routes: `/api/candidates`, `/api/assets/{upload,id}`, `/api/tagging/{smart-tag,lasso}`, `/api/compose`
- `pytest tests/test_compose_smoke.py` ✓

**Commit:** `bef2a18`

## ✅ Phase 2 — frontend Inspiration Grid + Smart Tag popover

- `Topbar` (prompt + Generate), `InspirationGrid` (4 tiles), `SmartTagPopover`
  (per-dimension chips + tag pills), `FusionStackPreview` (right panel)
- zustand store with curated-concept list, `toFusionStack()` serializer
- CORS widened to allow 127.0.0.1:3000

**Commit:** `d57a5e6`

## ⏳ Phase 2.5 — interaction refinements (current)

- **Per-tag selection** in Smart Tagging — every tag is independently
  like/dislike-able; designers can pick "warm" from Color without taking
  "glowing" and "amber".
- Backend mock candidates use real placeholder images uploaded by the user
  to `frontend/temporary_assets/`.
- Update Fusion Stack panel to render the selected-tag subset, not the whole
  dimension's tag list.

## Phase 3 — Feature Fusion Stack ↔ Compose

Goal: clicking a single button turns the curated stack into a real composed
image via IP-Composer.

- Promote `FusionStackPreview` into a proper `FeatureFusionStack` panel
  styled per the screenshot ("Curator Tiles" with image thumbnails, expanded
  dimension labels, strike-through for negative groups)
- Add **Compose** button at the top (or in Topbar next to Generate)
- On click: `useCurator.toFusionStack()` → `api.compose(stack)` → display
  result in a new central "Result Canvas" view (toggle between candidate grid
  and result canvas)
- Show `used_mock=true` banner clearly when IP-Composer was unreachable
- Edit case: re-clicking Compose with modified stack just replaces the result
- **Acceptance**: with `localhost:12100` running, the result image is a real
  IP-Composer output. With it offline, the user sees a "MOCK COMPOSITE" with
  a yellow banner.

## Phase 4 — Lasso (react-konva)

Goal: select a sub-region of any image (candidate or result) and tag just
that ROI.

- Replace the static `<img>` tile with a react-konva Stage when the user
  enters "Lasso mode" (toggle button per tile, or shift+click to enter)
- Free-draw polygon via mousedown→mousemove→mouseup; render as semi-transparent
  filled `Line` with `closed=true`
- On polygon close: collect points (in image coords, account for scaling)
  → POST `/api/tagging/lasso` with `{asset_id, polygon, dimensions}`
- Backend already crops + neutral-gray fills + sends to VLM mock → returns
  `cropped_asset_id` + tags
- The returned cropped image enters the Fusion Stack as a new asset (the
  "uuid-D-lasso-1" pattern in the protocol). Its tags appear in a
  SmartTagPopover variant scoped to that ROI.
- **Acceptance**: user can draw a lasso on Image_D's dome, tag it as
  "Subject: cloud formations", and have it appear as a separate group in
  the Fusion Stack with the cropped thumbnail.

## Phase 5 — Intensity Mixer (sliders)

Goal: after a result is composed, the designer can tweak each slot's alpha
without re-tagging.

- Bottom panel `IntensityMixer`, one slider per concept in the stack
  (range −1 to +1, default ±1 based on sign)
- Drag → debounced (~200ms) re-call of `/api/compose` with the same stack
  but modified alphas — IMPORTANT: keep the same seed so global composition
  is stable
- "Mixer Group" lock UI: select multiple sliders → they drag in unison
  (preserve ratios). Matches the "Locked" chip in the screenshot.
- Show before/after thumbnails next to the slider rail (Screenshot's design)
- **Acceptance**: composing → drag Style slider from 1.0 down to 0.3 → result
  refreshes with the same composition but weaker Style influence.

## Phase 6 — Persona panel + real VLM + real image-gen

Goal: persistent design "personas" so a designer's preferences carry across
sessions.

- Left sidebar `PersonaPanel`: shows current persona name + a flat tag
  cloud of all curated concepts (color-coded by dimension)
- **Save as Persona** button: writes `{name, fusionStack, finalImageId,
  timestamp}` to `backend/storage/personas/<slug>.json`
- **Load Persona** dropdown: restores stack + base asset state
- Replace `vlm_tagger_client` mock with real GPT-5.4 call (image → structured
  JSON per dimension). Use a system prompt that enforces strict JSON output.
  Honor `OPENAI_BASE_URL` from `.env`.
- Replace `image_gen_client` mock with whatever real service the user
  designates (decision deferred).
- **Acceptance**: open the app fresh, load "Spooky & Ethereal" persona, the
  same fusion stack + asset references re-hydrate and re-composing reproduces
  a similar result.

## Future / nice-to-have (out of scope for v1)

- Multi-user / auth
- History timeline of composed results
- Export pipeline (PNG, JSON of full stack)
- Mobile / touch ergonomics
- Real-time collab (multiplayer cursors)

# PrefCurator System

An interactive design-preference curation interface. Designers iteratively express what they like / dislike about candidate inspiration images, then the system composes a new image by mixing the selected semantic features via [IP-Composer](http://localhost:12100).

## Architecture

```
frontend/  Next.js (App Router) + React + TypeScript + react-konva
backend/   FastAPI (Python 3.10)
           ├─ services/ip_composer_client.py  → POST http://localhost:12100/compose
           ├─ services/vlm_tagger_client.py   → GPT (smart tagging)
           └─ services/image_gen_client.py    → initial 4 candidates (mock first)
```

The backend acts as the single integration layer: the frontend never talks to IP-Composer / VLM / image-gen services directly.

## Quick start (dev)

### Backend

```bash
conda activate PrefSys
cd backend
pip install -e .
uvicorn app.main:app --reload --port 8000
# health: http://localhost:8000/health
```

### Frontend

```bash
cd frontend
npm install
npm run dev
# open http://localhost:3000
```

### Env

Copy `.env.example` → `.env` at repo root (backend reads it). Frontend reads `frontend/.env.local`.

## Phases

See [`docs/PLAN.md`](docs/PLAN.md) (mirrored from `~/.claude/plans/`). Current phase: **Phase 0 — scaffolding**.

| Phase | Deliverable |
|---|---|
| 0 | Repo scaffold, dev servers boot |
| 1 | Mock service clients + all backend routes |
| 2 | Inspiration grid + smart-tag popover (frontend) |
| 3 | Feature Fusion Stack + Compose button (real IP-Composer) |
| 4 | Lasso canvas (react-konva) |
| 5 | Intensity Mixer sliders |
| 6 | Persona save/load + real VLM + real image-gen |

# sos-admin

Admin tool for the KU Leuven **Summer of Science** application workflow: import applications, run checks, assign courses and dorm places, track admissions and payments.

- Runs entirely in the browser. Data lives in a private Google Sheet; it is never stored in this repository or on any server.
- This repository contains **code and synthetic test data only**.

Docs: [`docs/DESIGN.md`](docs/DESIGN.md) · [`docs/REMINDERS.md`](docs/REMINDERS.md) · [`docs/ORIGINAL_PLAN.md`](docs/ORIGINAL_PLAN.md) · test data: [`test-data/`](test-data/)

Status: phase 1 (season setup, CSV import, checks, review screens, audit log) built, running on synthetic demo data. Google Sheets connection comes in phase 2.

## Running it

Needs Node.js 20.19+ (or 22.12+).

```bash
npm install
npm test          # unit tests against test-data/ (the oracle in expected_applications.json)
npm run dev       # http://localhost:5173/sos-admin/
npm run build     # production build in dist/
```

Pushing to `main` runs the tests and deploys to GitHub Pages (`.github/workflows/deploy.yml`).

## Code layout

- `src/core/` — all business logic, pure TypeScript, no UI: CSV decoding/parsing, column mapping, import planning (IDs, import keys, exact/near duplicates), automatic flags, and `Repo` (domain operations + audit logging on top of a `TableStore`).
- `src/store/` — store implementations. Phase 1: demo store (in memory, synthetic data). Phase 2: Google Sheets.
- `src/ui/` — Preact screens; they only call `Repo` and core functions.
- `tests/` — Vitest tests driven by `test-data/`.

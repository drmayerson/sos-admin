# sos-admin

Admin tool for the KU Leuven **Summer of Science** application workflow: import applications, run checks, assign courses and dorm places, track admissions and payments.

- Runs entirely in the browser. Data lives in a private Google Sheet; it is never stored in this repository or on any server.
- This repository contains **code and synthetic test data only**.

Docs: [`docs/DESIGN.md`](docs/DESIGN.md) · [`docs/REMINDERS.md`](docs/REMINDERS.md) · [`docs/ORIGINAL_PLAN.md`](docs/ORIGINAL_PLAN.md) · test data: [`test-data/`](test-data/)

Status: phases 1–4 built: import and checks, Google Sheets, assignment, locking, fees and aid, admissions, payments (matching, proof check with in-browser text recognition, reminders), LLM packets (Flemish schools, motivation, prerequisites), rosters and lists, new-season archive.

## Running it

Needs Node.js 20.19+ (or 22.12+).

```bash
npm install
npm test          # unit tests against test-data/ (the oracle in expected_applications.json)
npm run dev       # http://localhost:5173/sos-admin/ (first copies the OCR engine into public/ocr/)
npm run build     # production build in dist/
```

Pushing to `main` runs the tests and deploys to GitHub Pages (`.github/workflows/deploy.yml`).

## Code layout

- `src/core/` — all business logic, pure TypeScript, no UI: CSV decoding/parsing, column mapping, import planning (IDs, import keys, exact/near duplicates), automatic flags, and `Repo` (domain operations + audit logging on top of a `TableStore`).
- `src/store/` — demo store (in memory, synthetic data), Google sign-in (`googleAuth.ts`, holds the public OAuth client ID), Sheets API client and `SheetsStore`.
- `src/ui/` — Preact screens; they only call `Repo` and core functions.
- `tests/` — Vitest tests driven by `test-data/`.

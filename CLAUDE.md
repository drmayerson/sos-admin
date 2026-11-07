# CLAUDE.md — instructions for Claude Code in this repo

You are building the **KU Leuven Summer of Science (SOS) admin app** for Daniel Mayerson (the SOS coordinator). Read this file, then `docs/DESIGN.md` (full design + all decisions so far), `docs/ORIGINAL_PLAN.md` (Daniel's original plan) and `docs/REMINDERS.md`.

## Hard rules (non-negotiable)

1. **No real personal data, ever.** You only work with synthetic data (`test-data/`). Never ask Daniel to paste, upload or commit real applications, payment rows, names, e-mails or screenshots. If you see something that looks like real applicant data in the repo or working directory, stop and tell Daniel.
2. **This repo is public** (GitHub Pages, free plan). Commit no data, no API keys, no tokens, no personal e-mail addresses. The Google OAuth *client ID* is not secret and may be committed; nothing else credential-like may be.
3. **Personal data flows only between Google (the master Sheet) and the user's browser.** No backend server, no third-party analytics, no external logging, no fonts/scripts that phone home with data. Don't cache real applicant data in `localStorage`/IndexedDB (demo mode with synthetic data may).
4. **LLM steps get the minimum**: an anonymous application ID plus the one field needed (see DESIGN.md §LLM steps), with the student's own name/e-mail/phone/school replaced by placeholders. Never send names, contact details, medical/dietary data or screenshots to an LLM.
5. **Never auto-reject students.** Rules produce *flags* for human review; a human decision always overrides.
6. **The Google Sheet is the ground truth.** Every change the app makes to a record is written to the `AuditLog` tab (timestamp, user, application ID, field, old value, new value).

## Who you're working with

Daniel is a physicist, not a professional developer: comfortable reading and running code, prefers concise explanations, wants options and reasoning surfaced for non-trivial decisions, and cross-checks everything. Explain what he must do himself (e.g. Google Cloud setup) as short numbered steps.

## Recommended stack (change only with a good reason, and tell Daniel)

- **Vite + TypeScript** single-page app, small UI framework (Preact or React), deployed to GitHub Pages at `https://drmayerson.github.io/sos-admin/` via a GitHub Actions workflow (`base: '/sos-admin/'`). Add `<meta name="robots" content="noindex">`. Do NOT link it from Daniel's home page repo.
- **PapaParse** for CSV (`;` delimiter, UTF-8, quoted multi-line fields), **SheetJS** for Excel/mail-merge exports, **Google Identity Services** (OAuth token flow) + **Sheets API v4** from the browser.
- Text recognition for payment proofs (phase 3): **Tesseract.js**, in the browser.
- **Architecture:** keep all business logic (parsing, dedup, validation, flags, assignment, fees, payment matching) in pure TypeScript modules under `src/core/` with **Vitest** unit tests driven by `test-data/`. The UI only calls core functions and a storage interface with two implementations: `DemoStore` (in-memory/IndexedDB, loads synthetic data — so the app can be clicked through without Google) and `SheetsStore` (Google Sheets).
- Address Sheet columns **by header name**, never by position.

## Build phases (see DESIGN.md for detail)

1. Season setup (courses, dates, fees, thresholds, column mapping) + CSV import (skip blank rows and already-imported rows, assign IDs, exact-duplicate removal, near-duplicate flags) + validation flags + review screens (young students, flags) + audit log + DemoStore.
2. Google Sheets connection, assignment algorithm (with preview of changes), locking, fees, financial aid, admission mail-merge export.
3. Payment CSV import, matching, proof-of-payment check, deadlines, reminders.
4. LLM steps (FL school check, motivation check), prerequisite helper, rosters/exports, new-season archive.

Start with phase 1. Before writing lots of code, propose the data model (Sheet tabs and columns) and the screen list to Daniel and get his OK.

## Test data

`test-data/generate.py` (deterministic, seed fixed) produces the synthetic CSVs in the exact 2026 export format. `test-data/EXPECTED.md` lists every deliberate edge case and the flag/outcome the app should produce — use it to write tests. Regenerate with `python3 test-data/generate.py`.

## Keeping docs current

When Daniel makes a design decision, update `docs/DESIGN.md` in the same commit. Daniel's planning notes also live in a claude.ai project ("Summer of Science"); `docs/DESIGN.md` is the repo copy and should stay consistent with it.

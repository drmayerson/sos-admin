# SOS admin app — brief for an independent review

*Written 10 Nov 2026 for a reviewer (human or AI agent) who has not seen how this app was built. Read this first, then
`CLAUDE.md`, `docs/DESIGN.md` (the authoritative design and every decision so far), `test-data/EXPECTED.md` and
`docs/REMINDERS.md`.*

## 1. What the app is for

The **KU Leuven Summer of Science (SOS)** is a one-week science summer school for high-school students (mostly 15–18),
run in two sessions each July/August, with ~10 courses and ~200 students per year. Students apply through a web form on
the KU Leuven website; the coordinator (Daniel Mayerson, a physicist, not a professional developer) downloads the
applications as CSV and until now processed them by hand in spreadsheets.

This app automates that workflow end to end:

1. **Import & checks** — import the application CSV (always the full export; only new rows are added), assign anonymous
   IDs in posting order, detect exact and near duplicates, and raise **flags** for human review (young students, too old,
   no course chosen, short motivation, …). Nothing is ever rejected automatically.
2. **Assignment** — place students in courses (Flemish-school students first, then first-come-first-served, respecting
   preferences, prerequisites, course limits, dorm capacity), with a preview of every change before it is written;
   waitlist, "dorm full" list, locking (= communicated to the student), fees, financial aid, admission mail merge.
3. **Payments** — import the payment-form CSV, link each payment to an application, check the proof of payment
   (screenshots/PDFs read in the browser), deadlines, reminders.
4. **LLM helpers & lists** — prepare anonymised "packets" for Claude (Flemish-school check, motivation check, course
   prerequisites) and import the answers; course rosters (PDF student cards), mailing lists, dashboard, T-shirt counts;
   unenrolling (also after payment, with a reimbursement list); starting a new season.

Users: Daniel now; possibly a few colleagues later (not supported yet, see §8).

## 2. Non-negotiable rules (verify these hardest)

From `CLAUDE.md` — the app handles personal data of minors, including health data:

1. **No real personal data in the repo, ever.** Only synthetic data (`test-data/`). The repo is public (GitHub Pages).
2. **No secrets in the repo.** The Google OAuth *client ID* in `src/store/googleAuth.ts` is public by design; nothing
   else credential-like may be committed.
3. **Personal data flows only between Google (the master Sheet) and the user's browser.** No backend, no analytics, no
   external logging, no CDN fonts/scripts that could leak data. Real applicant data must not be cached in
   `localStorage`/IndexedDB (only the Sheet ID/title and the user's own e-mail are remembered). The OCR engine, language
   data and PDF font are served by the app itself.
4. **LLM steps get the minimum**: the FL packet holds only school names; the motivation packet holds an anonymous ID +
   redacted motivation (student/parent names, e-mails, phones, school → placeholders). Never names, contact, medical
   data or screenshots. The app never calls an LLM itself (Daniel carries packet files to claude.ai and back).
5. **Never auto-reject students.** Rules produce flags; a human decision always overrides.
6. **The Google Sheet is the ground truth**, and every change the app makes to a record goes to the `AuditLog` tab
   (timestamp, user, application ID, field, old value, new value, action).

## 3. Architecture and code map

- Static single-page app: **Vite + TypeScript + Preact**, deployed to GitHub Pages (`https://drmayerson.github.io/sos-admin/`)
  by `.github/workflows/deploy.yml` (runs the tests, then builds). `<meta name="robots" content="noindex">`.
- **Google sign-in**: Google Identity Services token flow, scopes `drive.file openid email` (the app can only see Sheets
  it created). Access token in memory only. **Sheets API v4** called directly from the browser.
- **Storage abstraction** (`src/core/store.ts`): `TableStore` with `MemoryTableStore` (demo + tests), `SheetsStore`
  (`src/store/sheetsStore.ts`, Google Sheets; RAW writes; rows located by key with a fresh read before every write) and
  `ReadOnlyStore` (archived seasons). Columns are always addressed by header name.
- **All business logic** is pure TypeScript in `src/core/`; the UI (`src/ui/`) only calls `Repo` (`src/core/repo.ts`,
  domain operations + audit logging) and pure core functions.

| Area | Core | UI screen(s) |
|---|---|---|
| Types, column names | `types.ts` | — |
| Season config (Config/Sessions/Courses tabs), next season | `config.ts` | `Setup.tsx`, `NewSeason.tsx` |
| CSV decoding (UTF-8 strict, Excel re-save refused), parsing | `csv.ts`, `headers.ts`, `dates.ts`, `text.ts` | `Import.tsx` |
| Import plan: IDs, import keys, exact/near duplicates, person linking | `importer.ts` | `Import.tsx`, `Merge.tsx` |
| Automatic flags, derived choices | `flags.ts` | `Flags.tsx`, `FlagComments.tsx` |
| Young students (per-course OK/NOT OK, close rules) | `young.ts` | `Young.tsx` |
| Assignment, prerequisites, locking rules, stages | `assign.ts` | `Assignment.tsx`, `Waitlist.tsx`, `DormFull.tsx`, `Locking.tsx` |
| Fees, aid | `fees.ts` | `FinancialAid.tsx` |
| Admission mail merge | `admission.ts` | `Admissions.tsx` |
| Payment import + matching | `payments.ts` | `Payments.tsx` (Import / Match) |
| Proof-of-payment text checks, IBANs, file pairing | `proof.ts` (+ `src/ui/ocr.ts`: pdf.js, Tesseract.js) | `Payments.tsx` (Proofs) |
| Deadlines, reminders | `deadlines.ts` | `Payments.tsx` (Awaiting payment) |
| LLM packets, redaction, answer parsing | `llm.ts` | `LlmScreens.tsx` |
| Rosters, mailing lists, session e-mail list | `rosters.ts`, `exports.ts` (+ `src/ui/pdf.ts`) | `Exports.tsx` |
| Dashboard, T-shirts | `dashboard.ts` | `Dashboard.tsx` |
| Unenrolling, reimbursements | `unenroll.ts` | `Unenroll.tsx`, `Reimbursements.tsx` |
| Edit/search/full view of applications | `fieldOptions.ts` | `Applications.tsx` |
| Google auth, Sheet create/open, demo | — | `src/store/*`, `Connect.tsx`, `App.tsx` |

Data model (tabs and columns): `docs/DESIGN.md` §2 and the "as built" subsections; column constants in `src/core/types.ts`
(`APP_COLS`, `FLAG_COLS`, `PAY_COLS`, …). Tabs: `Applications`, `Flags`, `RawImports`, `AuditLog`, `Config`, `Sessions`,
`Courses`, `Payments`, `Schools`.

## 4. How to run and test

```bash
npm install
npm test          # Vitest, ~100 tests, driven by test-data/ (oracles: expected_applications.json, expected_payments.json)
npm run dev       # http://localhost:5173/sos-admin/  → "Open demo" (synthetic data in memory; nothing saved)
npm run build
```

- The **demo** has buttons to load the synthetic application CSV, the Excel-mangled CSV (must be refused), the synthetic
  payment CSV, and to generate fake proof-of-payment images (named `<payer e-mail>__<file>`).
- `tests/fakeSheets.ts` is an in-memory imitation of the Sheets API; `tests/sheetsStore.test.ts` runs the whole flow
  against it and compares with the in-memory store.
- Synthetic data: `test-data/generate.py` (deterministic). `EXPECTED.md` lists every deliberate edge case (E01–E33,
  P03–P12) and the expected outcome.
- Google sign-in can only be tested by Daniel (OAuth app in testing mode). Don't attempt it.

## 5. What to review

Please report concrete findings, each with severity (critical / high / medium / low), file:line, a reproduction or
failing input, and a suggested fix. Prefer verified problems over speculation; say when something is a guess.

### 5.1 Privacy and security (highest priority)
- Any path by which personal data could leave the browser other than to `sheets.googleapis.com` /
  `openidconnect.googleapis.com` (network requests, third-party scripts, fonts, error reporting, workers fetching from CDNs).
  Check `src/ui/ocr.ts` (Tesseract worker/core/lang paths), `src/ui/pdf.ts` (font), `index.html`, `vite.config.ts`.
- Anything personal stored in `localStorage`/`sessionStorage`/IndexedDB (Tesseract caches the *language model* in
  IndexedDB — that's expected; anything else is not).
- Token handling in `src/store/googleAuth.ts` (memory only? renewal? revocation on sign-out?).
- **Redaction** in `src/core/llm.ts` (`redact`, `redactMotivation`): can a student's name/e-mail/phone/school survive
  (case, accents, hyphenated or compound names, names inside e-mail addresses, initials, possessives like "Jan's")? Does
  it over-redact harmlessly or break text? Is anything else personal in the packets?
- **Formula/CSV injection**: Sheet writes use `valueInputOption=RAW` (check every write path). Exports: SheetJS Excel
  files and the mailing-list CSV/TXT contain applicant-typed text — could a value like `=HYPERLINK(...)` become active
  when opened in Excel?
- XSS: any place applicant text is rendered as HTML (Preact escapes by default; look for `dangerouslySetInnerHTML` or
  URL building from data).
- The repo: no real data, no secrets (`git log -p` included).

### 5.2 Correctness of the core rules
- Import: re-import idempotency, ID order across DST (E32), exact vs near duplicates (E01/E03/E04), two-session students
  (E05), Excel-damaged files (E28), unpadded timestamps, blank rows, BOM.
- Flags: thresholds (E12–E18), `NO_COURSE_CHOSEN`, re-check after edits (no re-raising of human-decided flags).
- Assignment (`assign.ts`): determinism; FL priority; locked/pinned seats; course limits (soft max raisable to hard max,
  hard max never exceeded by the algorithm); NOT OK courses; prerequisites (age range, years left; hard / soft-priority
  two-pass / soft-flag); dorm capacity and the dorm-full list; preview == what is applied; YOUNG flag reopening after a
  course change.
- Locking blockers (unassigned, waiting for dorm, open YOUNG flag, Flemish status still "claimed").
- Fees and aid (aid never above fee; fee follows accommodation and FL status; amount due).
- Payments: matching (`payments.ts`) vs `expected_payments.json`; never guessing between siblings/shared names;
  duplicate submissions; proof analysis (`proof.ts`: amount formats, reference, IBAN check digits); approval → `PaidAt`,
  `AmountPaid`; deadline/reminder flags (once per deadline; resolved on payment).
- Unenrolling (`unenroll.ts`, `Repo.unenroll`): effects text matches what actually happens; paid students require note
  + reimbursement choice; freed places; reimbursement export.
- Lists: default = admitted AND paid; session e-mail list dedup (E33, siblings, parents only when opted in).
- New season: settings carried over correctly; archived season really read-only in the app.

### 5.3 Robustness against the real world
- `SheetsStore` when the Sheet is edited by hand (sorted rows, inserted columns, renamed/missing headers, duplicate IDs,
  blank rows, values typed as numbers/dates by Google Sheets). Quotas (number of API calls per action), 401/429 handling.
- Two browser tabs or two people at once (stale caches; the "data changed since the preview" checks).
- Large inputs (a few hundred applications, ~100 proof files): performance of redaction, OCR, PDF generation.
- Audit completeness: is *every* change to an application/flag/payment/config logged with old and new value? (Look for
  writes that bypass `bulkUpdate`/`payUpdate`.)

### 5.4 Usability for a non-developer
- Are destructive or large actions always confirmed, and do the confirmations say what will happen?
- Error messages: understandable, actionable, never silent failures.
- Anything confusing in the workflow order or naming (menu in `src/ui/App.tsx`).

## 6. Known limitations (already accepted — mention only if you see a real risk)
- One master Sheet per season; colleagues can't open it yet (needs Google Picker or a broader scope).
- The proof check is a helper: "likely OK" still needs a human click; files must be named `<payer e-mail>__<name>` to
  pair reliably (to be arranged with a Power Automate flow).
- Real-export details not yet verified: unticked checkbox value (empty vs `FALSE`), always 6 digits in the fraction of
  a second.
- The demo keeps everything in memory (lost on reload) by design.
- Local builds in the Dropbox folder occasionally fail on a file lock; CI is unaffected.

## 7. Open questions for Daniel (context — do not decide these, but flag findings that bear on them)
1. Closing a young-student flag warns about "Student dorm OK" only for FULL students (EVENING/DAY don't sleep in the dorms). OK?
2. Proof "likely OK" = amount + (reference OR IBAN). Or require all three?
3. Payments are linked automatically by e-mail and by a *unique* exact student/parent name. Should name-only matches always be confirmed by hand?
4. Student-card PDF: is the page layout right (compared with a 2025 card)?
5. Session e-mail list (`email name` per line, parents as "Name (parent of Student)"): does the mailing-list server accept this format?
6. Dashboard "Max" per course: show the current limit (now) or the soft max?
7. Mail-merge exports (admission, reminders): which columns exactly?

Other open items (colleague access, data-protection review and retention period, which Google account owns the Sheet,
the Power Automate flow, new-season form changes) are in `docs/DESIGN.md` §9.

## 8. Ground rules for the reviewer
- Work only with the synthetic data in `test-data/`. Never ask for, request or upload real applications, payments or screenshots.
- Don't push, deploy or change the live site. Code changes only if asked; findings first.
- Don't try to sign in with Google or reach the real Sheet.
- When something in the design itself looks wrong (not just the code), say so — Daniel wants options and reasoning surfaced.

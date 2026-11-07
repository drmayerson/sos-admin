# SOS admin app — design and decisions

*Living document. Started 7 Nov 2026 from planning sessions with Daniel. The original plan is in `ORIGINAL_PLAN.md`; where this document differs, this document wins.*

## 1. Goal

Automate the Summer of Science application workflow (intake → checks → course/dorm assignment → admission → payment) in a browser app, while keeping personal data away from LLMs. LLMs are used only for a few narrow judgement calls, on minimal pseudonymised input.

## 2. Architecture

- Static single-page app on GitHub Pages (`drmayerson.github.io/sos-admin/`), code only, no data in the repo. Not linked from the home page; `noindex`.
- Google sign-in (OAuth token flow; Google Cloud project in "testing" mode with Daniel as test user) → the browser reads/writes the master Google Sheet through the Sheets API. Personal data only flows Google ↔ browser.
- **The Sheet is the ground truth.** Tabs (agreed with Daniel, 7 Nov 2026). All columns are addressed by header name, so later phases simply add columns.
  - `Applications` — one row per application.
    - App-managed columns: `ID`, `ImportKey`, `PersonKey` (links one student's applications, e.g. both sessions), `PostingUTC` (ISO, GMT offset applied; used for ordering), `Status` (active / merged / withdrawn), `MergedInto`, `WithdrawnReason`, `Session` (S1/S2), `Choice1`–`Choice3` (preference list: "(Not applying…)", gaps and repeats removed, e.g. `— / EXPTECH / —` → `EXPTECH / — / —`), `FLStatus` (claimed / confirmed / rejected / n.a.), `OpenFlags` (read-only convenience summary; the `Flags` tab is the source of truth), young-student notes `EmailSentCourse`, `CourseOK`, `EmailSentStudent`, `DormOK`, per-course decisions `OKForCourses` / `NotOKForCourses`, `AssignedCourse` (filled in phase 2), `YoungApprovedWith` (assigned course when the YOUNG flag was closed), and `Notes`.
    - Form fields: the 41 data columns under their original header text (the 9 decorative columns are dropped).
    - Phase 2 adds assignment, lock, fee, aid and admission columns.
  - `Flags` — one row per flag: `FlagID`, `AppID`, `Type`, `Detail`, `Status` (open / approved / overruled / resolved), `Note` (decision note), `Comments` (running log of actions taken, one dated line each), `CreatedAt`, `ResolvedBy`, `ResolvedAt`. Resolved flags stay as history.
  - `RawImports` — every imported CSV row exactly as received (+ `ImportedAt`, `RowNo`, `ImportKey`, `AppID`), never modified.
  - `AuditLog` — every change made through the app (imports, edits, merges, flag decisions): `Timestamp`, `User`, `AppID`, `Field`, `OldValue`, `NewValue`, `Action`.
  - `Config` — key/value rows: fees, thresholds, ID prefix, payment deadline days, column mapping (`map.<field>` → header text).
  - `Sessions` — key, form label, start date, dorm capacity.
  - `Courses` — session, code, soft max, hard max (phase 2 adds prerequisite rule / "no prerequisites").
  - `Schools` (phase 4) — school-name aliases with confirmed "Flemish: yes/no" (grows each year).
  - `Payments` (phase 3) — imported payment-form rows + their matching state.
- **Phase 1 screens:** Home (counts, demo banner), Season setup (incl. column-mapping check), Import CSV (encoding check → preview → confirm), Near-duplicate merge, Young students, Flags, Applications (search/detail/edit/history), Audit log.
- **Exact duplicate** = all form fields except the timestamp equal after trimming, whitespace collapsing and case-folding. Exact duplicates get no ID and no `Applications` row: they are kept only in `RawImports` (column `DuplicateOf`) and noted in the `AuditLog` of the original.
- **Flemish claim** in phase 1 only sets `FLStatus = claimed` (no flag), so the Flags list isn't swamped; the school check comes in phase 4.
- **Automatic flags are re-checked after every edit/merge:** new problems get a flag; open automatic flags that no longer apply are closed as "resolved" (logged); a flag a human approved/overruled is never re-raised.
- **Merge** keeps the earliest application's ID and timestamp; default choice per differing field is the most recent submission's value.
- **3+ near-duplicates:** every later submission is flagged against the *earliest* one, so they form one group; the merge screen shows all versions side by side, you pick each differing field from any version, and all later ones are merged in one go (or individually kept separate).
- **Unreadable Posting Date/Time blocks the whole import** (instead of skipping rows), so IDs can't end up out of posting order. Time parts may be unpadded (`10:03:9.874100`, seen in the real export).
- **Editing:** fields with fixed answers (session, course choices, gender, T-shirt, years left, accommodation, fallback, "I am a", laptop, photo, checkboxes) are dropdown-only; a stored value that isn't a form answer stays visible, marked. The posting time is read-only.
- **Medical/dietary fields** are hidden on the application screen until "Show" is clicked.
- **One Sheet per season.** A "Start new season" wizard creates a fresh Sheet, carries over the column mapping (the form is expected to stay identical apart from course codes, dates and year-specific header text such as "2025-2026" / "July 2026"), asks for courses/capacities/dates/fees, and shows the setup checklist (`REMINDERS.md`). The previous Sheet is archived read-only and viewable from a season switcher. Retention period for archived personal data: to be decided with KU Leuven's data protection officer (DPO).
- Google account: initially Daniel's own or a KU Leuven-linked account; the app must not hard-code it (moving = copy the Sheet, point the app at it).
- DPO review before going live with real data.

## 3. Stage 1 — import and checks

### Import
- Upload the application CSV (always contains *all* applications so far).
- Decode as **UTF-8** (with or without BOM). If the file isn't valid UTF-8 or looks like an Excel re-save (Windows-1252, mangled characters), warn and ask for the original download — Excel damages non-Western characters.
- Skip fully empty rows (`;;;;…`).
- **Import key** (to recognise rows already imported): `Posting Date/Time` (microsecond precision) + student e-mail (normalised). Stored in a hidden column.
- New rows get an anonymous **application ID** (e.g. `SOS26-0001`, in posting order), used everywhere including LLM steps.
- **Exact duplicates** (all form fields identical apart from the timestamp, after trimming/normalising) → keep the first, mark the rest as duplicates automatically.
- **Near-duplicates** (same student — normalised e-mail, or name + birth date — and the *same session*, but some fields differ) → flag for review. Typical case: the student resubmitted to correct something. The review screen offers a merge that picks fields from either version and **keeps the earliest timestamp** (the student keeps their first-come-first-served place). Until merged, a near-duplicate is imported with its own ID; after merging, the later application is marked "merged into SOS…" (not deleted).
- The same student applying to **both sessions** submits two applications: these are *not* duplicates. Link them (shared person key) for display.

### Automatic checks (each produces a flag; nothing is rejected)
- **Course choices:** treat empty and "(Not applying to Session X)" as "no choice". Only flag `NO_COURSE_CHOSEN` when the chosen session has no course at all (the detail lists any other-session courses: wrong session selected?). Gaps, repeated courses and extra other-session courses are harmless and not flagged (Daniel, 7 Nov 2026).
- **Young student:** years left = `>2`, OR age ≤ 14 on the start date of the chosen session.
- **Too old:** age ≥ 19 on the session start date.
- **Short motivation:** fewer than ~50 words (threshold configurable).
- **FL claim** ("Student at a Flemish (Dutch-speaking) school") → school must be checked (see §6).
- All thresholds are season settings.

### Review screens
- **Young students** (revised 7 Nov 2026): one card per student showing the provisional assignment, motivation and (if non-empty) other remarks.
  - "Our notes:" checkboxes: e-mail sent to course, course OK, e-mail sent to student, student dorm OK.
  - Per course in the session: **OK / NOT OK / no decision**, saved explicitly. The assignment algorithm respects OK and NOT OK; with no decision it assigns as usual.
  - A separate **OK** button closes the YOUNG flag. It warns (but allows) when the assigned course isn't marked OK or, for FULL students, "student dorm OK" isn't ticked. The assigned course at that moment is stored; **if the student is later reassigned to a different course, the flag reopens automatically** (phase 2).
- **Flags:** list of all open flags with a running **comments / actions taken** log (e.g. "e-mailed the student") and, separately, the decision "approve anyway / overrule / resolve" with a note; resolved flags stay visible in history.
- **Search & edit** any application; every edit is logged in `AuditLog`.

## 4. Stage 2 — assignment

- Button "(Re)assign": all students whose assignment is **not locked** are unassigned and reassigned. The algorithm is deterministic (same input → same output) and shows a **preview of the changes** before writing.
- Warn before running if there are unlocked students who applied more than two weeks ago.
- Rules:
  - Course prerequisites are stored as structured rules (e.g. "age at session start ≥ 16") and produce flags/ineligibility that a human "OK for course" decision overrides. For each course, either a rule or an explicit "no prerequisites" checkbox is required before assignment can run (error otherwise). An LLM may help turn free text into a rule; the human confirms.
  - **FL students have priority** for course places and dorm places. An FL student can bump an *unlocked* non-FL student — this is intended.
  - Otherwise first-come-first-served (posting timestamp; merged resubmissions keep the earliest).
  - Course capacity: soft max (flag to the user when reached) and hard max (never exceeded).
  - Dorm capacity per session (not split by gender; admission isn't gender-based). When dorms are full, the form's fallback answer applies: become EVENING, become DAY, or don't participate. In practice handled ad hoc (dorms first filled up in 2026) → show the affected students in order and let the human decide; the fee follows the accommodation type.
  - Flagged students are **not penalised**: a place is held for them while their flag is open.
  - Waitlist: no fixed rules → an ordered list of unassigned students with their choices and timestamp, plus manual assignment.
- **Locking:** individually, batch-lock all FL applications up to a date, or batch-lock all applications up to a date. Locked = communicated to the student, never changed by reassignment.
- **Fees:** by status (Flemish school vs other) × accommodation (FULL/EVENING/DAY), minus financial aid. 2026: FULL 380/430, EVENING 280/330, DAY 200/250 EUR.
- **Financial aid:** search a student, add/change an amount (also after admission); fee updates immediately; overview list with total aid given. (A separate financial-aid application form exists — possible future import.)
- **Admission e-mail export:** Excel for mail merge of all locked, not-yet-admitted students, including the **parent e-mail** (admission/payment e-mails always go to the parent too). Students are marked "admitted" (with date) only after the user confirms "I've sent these".

### Phase 2 decisions (Daniel, 7 Nov 2026)
- **Capacity:** the algorithm fills each course up to its **current limit**, which starts at the soft max. A course that is full while students are waiting for it is flagged in the preview; the user can raise the limit (never above the hard max) and re-run.
- **Course order per student:** their own choices in preference order, skipping courses marked **NOT OK**; after that, courses marked **OK** that weren't among their choices. An OK mark doesn't restrict the student to OK courses.
- **Prerequisites (structured):** per course, a minimum age on the session start date, or an explicit "no prerequisites" tick; assignment refuses to run while a course has neither. A course whose prerequisite the student doesn't meet is skipped, unless that course is marked OK for the student. Free-text prerequisite notes are informational.
- **FL priority and fee:** "claimed" counts as Flemish until rejected (confirmed → FL, rejected → other). The admission export warns about students still "claimed".
- **Order:** locked and manually assigned (pinned) students keep their seats first; then FL students by posting time, then the others by posting time (ties by ID). Flags don't affect the order.
- **Dorms full:** FULL students beyond the session's dorm capacity still get a course place and appear on a **"dorm full" list** in priority order with their form fallback answer; the user switches them to EVENING / DAY, withdraws them, or lets them wait. The fee follows the final accommodation.
- **Locking:** a student can't be locked while unassigned, while waiting for a dorm place, or while their **YOUNG flag is open**. Batch locks skip such students and report why.
- **Waitlist:** unassigned students in priority order; manual assignment pins a course (pinned students are never moved by re-runs, but aren't "locked" = not yet communicated).
- **Young flag reopens** automatically when a re-run assigns the student a course other than the one it was closed with.
- **Admission export:** one row per student: student and parent contact (parent e-mail repeated in a CC column only if it differs from the student's), session, course, accommodation, fee, aid, amount due, payment deadline (export date + deadline days). After "I've sent these", `AdmittedAt` and `PaymentDeadline` are written.
- **Sheet writes** use RAW input (no formulas are ever interpreted from applicant text) and locate rows by ID freshly before every write, so sorting the Sheet by hand is safe.
- **Google access:** OAuth token flow with the `drive.file` scope (the app only sees the Sheet it created) plus `email` for the audit-log user name. The access token lives only in memory (never in browser storage).
- **Return visits (one click):** the browser remembers the Sheet's ID and title and the user's own e-mail (as sign-in hint). The start screen then shows one button "Continue as …"; Google's pop-up flashes and closes without account chooser or consent screen. A fully click-free reload isn't possible without a backend (Google requires a click to open its sign-in window) or without storing the token in the browser, which we don't do.
- **App link:** "Copy app link to this Sheet" gives `…/sos-admin/?sheet=<ID>`; opening it preselects that Sheet (the ID is then remembered and removed from the address bar). The link holds no personal data.
- **Colleagues:** not supported yet — see §9 (still to be done / decided).

## 5. Stage 3 — payment

- Upload the payment-form CSV (5 columns: name, e-mail (student or parent), proof-of-payment *file name*, terms link, terms checkbox).
- **Matching:** e-mail against both the student and the parent e-mail (normalised) → exact match. Then fuzzy name matching (accent/case-insensitive, word order, partial names) showing the top 3 candidates for a human to click. LLM only for exceptional leftovers, with a minimal list.
- A student attending two sessions pays twice; one transfer may cover both. Until the form asks which session the payment is for (see `REMINDERS.md`), the human resolves ambiguous cases.
- **Proof check:** proof files come from the Outlook notification e-mails (see `REMINDERS.md`), dropped into the app as a folder and matched by file name. Text recognition runs in the browser (or text is read directly from PDFs); the app checks whether the **expected amount** (fee − aid, or the sum for two sessions; any format: `380`, `380,00`, `€ 380`, `-380.00 EUR`), the structured reference `400/0029/31560` and the KU Leuven IBAN `BE60 7340 0666 0370` appear → "likely OK" (one-click approve) or human review with the image next to the expected fee. Foreign bank screenshots often need a human.
- The payment reference is fixed by KU Leuven (+++400/0029/31560+++) and cannot be personalised; finance extracts are too late and the payer names unreliable → not used.
- Payment deadline per student (default: admission + 14 days) → flag when passed. Reminders: generate a mail-merge Excel or mark individual reminders as sent; multiple reminders allowed; a reminder can be marked "final", after whose deadline the student is flagged for a decision (e.g. unassign).

## 6. LLM steps (phase 4)

- **FL school check:** only for students claiming "Student at a Flemish (Dutch-speaking) school". Send a *deduplicated list of school-name strings only* (no IDs, no students). The LLM answers per school: Flemish yes / no / unclear. Definition: a Dutch-language school recognised by the Flemish Community, including Dutch-language schools in Brussels. French-speaking Belgian schools are simply "not Flemish" (no special status). "Unclear" → the human decides. Confirmed answers go into `Schools` for reuse.
- **Motivation check:** word count is an automatic (non-LLM) flag. The LLM gets ID + motivation text, with the student's first name, surname, e-mail, phone and school replaced by placeholders (case- and accent-insensitive). It flags motivations that are very short without reason, suggest the student is not a viable candidate (e.g. actually a university student, much too young), or are otherwise questionable — with one short sentence per flag. Results are written back as flags.
- Delivery mechanism to decide: (a) "export packet / import results" JSON files that Daniel passes to Claude, or (b) a direct API call with Daniel's own key kept only in his browser. (a) is the default.

## 7. Other

- Unenroll = status "withdrawn" (with reason + date), frees the place, keeps the record.
- Future: roster per course, medical/dietary list (special-category data — show only where needed), dorm hall allocation using the "same hall as" requests, photo-permission list.

## 8. 2026 export format (reference)

- Application CSV: `;`-separated, CRLF, UTF-8, quoted fields where needed (multi-line text possible). 50 columns, exact headers in `test-data/headers_2026.json`.
- Non-data columns to ignore: "Please carefully read…", "Student Information", "Parent Information", "Course Enrollment", "Fees", "Academic info", "Other", "more_info_activities", "Course page link". Payment CSV: ignore "termslink".
- Note: the header "If you have chosen to participate as a FULL student, are there any special requests you would like  to make…" contains a **double space**; the payment terms header has a **trailing space**. Match headers after whitespace normalisation.
- Birth date: `yyyy-mm-dd`. Posting Date/Time: `2026/02/15 09:52:32.419897 GMT+1` (GMT+2 in summer time).
- Checkboxes: `TRUE` when ticked (assumed empty when not — confirm with a real export).
- Values:
  - Gender `M` / `W` / `X`; T-shirt `XS` / `S` / `M` / `L` / `XL`
  - Session `Session I (20-24 July 2026)` / `Session II (3-7 August 2026)`
  - Session I courses: (empty) / `(Not applying to Session I)` / `ASTROPLASMA` / `MAGNETISM` / `NUCLEAR` / `QUANTUM`
  - Session II courses: (empty) / `(Not applying to Session II)` / `AVATAR` / `ATOMIC` / `BLACKHOLES` / `CELLNANO` / `EXPTECH` / `PROTEINS` / `RELATIVITY`
  - Years left `0` / `1` / `2` / `>2`
  - Accommodation `FULL` / `EVENING` / `DAY`
  - Fallback: `Not applicable` / `I DO NOT wish to participate in the summer school` / `I DO still wish to participate in the summer school, as an EVENING student.` / `I DO still wish to participate in the summer school, as a DAY student.`
  - Status ("I am a"): `Student at a Flemish (Dutch-speaking) school` / `Student at a Belgian International school` / `International student from abroad`
  - Laptop, Photo permission: `Yes` / `No`
- Grade/year is free text ("5de middelbaar", "Year 11", "10"…) — informational only; "years left" is the structured field.

### Unverified assumptions (check against a real export when possible)
- Exact quoting style and whether there's a BOM (the sample was re-saved by Excel). The parser must handle both.
- Whether the original download contains blank rows (the sample had many, probably from clearing data in Excel). Skip them either way.
- Unticked checkbox value (empty vs `FALSE`).

## 9. Still to be done / decided

*Parked items, collected here so nothing gets lost. Move an item into the relevant section once it is decided.*

- **Colleague access to the master Sheet** (parked by Daniel, 7 Nov 2026). With the `drive.file` scope a colleague can't open a Sheet Daniel created, even when it's shared in Drive. Options:
  - (a) *Google Picker* (recommended): the colleague picks the Sheet once in Google's file chooser; keeps the narrow permission. Needs the Picker API enabled and a browser API key restricted to `drmayerson.github.io` (~5 min setup).
  - (b) *Broader `spreadsheets` scope*: no picker, but the app gets access to all of the colleague's Sheets.
  - Either way: every colleague must be added as a test user (Google Cloud → Audience) while the app stays in testing mode (max. 100 users). The "Copy app link to this Sheet" link already exists for handing out the Sheet.
- **Data protection:** DPO review before going live with real data, and the retention period for archived seasons (§2).
- **Google account** that owns the master Sheet long-term: Daniel's own or a KU Leuven-linked account (§2).
- **To confirm:** closing a young-student flag requires "Student dorm OK" only for FULL students (EVENING/DAY students don't sleep in the dorms).
- **Real export details still unverified:** unticked checkbox value (empty vs `FALSE`); whether the fraction of a second in Posting Date/Time is always 6 digits (§8). Blank rows, BOM and unpadded time parts are handled.
- **LLM delivery mechanism** for phase 4: export/import JSON files (default) or a direct API call with Daniel's own key (§6).
- **New-season form changes** (payment form e-mail label + session radio button, proof-of-payment folder): see `REMINDERS.md`.

import { useState } from 'preact/hooks';
import { nextSeasonConfig } from '../../core/config';
import { createSheet } from '../../store/connect';
import { useApp } from '../ctx';

/** Checklist from docs/REMINDERS.md (kept in sync by hand). */
const CHECKLIST = [
  'Payment form: change the e-mail label to "E-mail address used in the application (student or parent)".',
  'Payment form: add "This payment is for: Session I / Session II / both sessions" (the app reads it automatically).',
  'Proof-of-payment files: save the attachments of the payment-form e-mails to one folder, named "<payer e-mail>__<original name>" (e.g. a Power Automate flow).',
  'Application form: update course codes in both session dropdowns, session dates, the "2025-2026" / "July 2026" texts, the deadline and the "(almost) full" list.',
  'In the new Sheet: check Season setup (session labels and dates, courses, capacities, dorm places, fees, thresholds) and enter prerequisites for every course.',
  'With the first export of the new season: check the column mapping (Season setup → "check against CSV").',
  'Decide with the DPO what happens to the archived season\'s personal data.',
];

export function NewSeason() {
  const { snap, repo } = useApp();
  const cur = snap.cfg;
  const [season, setSeason] = useState(cur ? String(Number(cur.season) + 1) : '');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  if (!cur) return <p class="warn">Set up the season first.</p>;
  if (cur.archived) return <p class="warn">This season is archived. Open the current season to start a new one.</p>;
  const next = /^\d{4}$/.test(season) ? nextSeasonConfig(cur, season) : null;

  const start = async () => {
    if (!next) return;
    if (!confirm(`Create the master Sheet for season ${season} and archive season ${cur.season} (read-only from then on)?`)) return;
    setErr('');
    try {
      setBusy('Creating the new Sheet…');
      const schools = (await repo.store.readAll('Schools')).filter((s) => s.Verdict);
      await createSheet(season, next, schools);
      setBusy(`Archiving season ${cur.season}…`);
      await repo.archiveSeason();
      setBusy('Done — opening the new season…');
      location.hash = '#/setup';
      location.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy('');
    }
  };

  return (
    <div>
      <h1>Start a new season</h1>
      <p>
        Creates a new master Sheet for the next season in your Google Drive, carrying over the settings below, and archives this
        season: it stays available read-only (pick it on the start screen under "Other account, other Sheet…"), and its tabs
        get a protection warning in Google Sheets.
      </p>
      <div class="panel">
        <h2>Checklist (from REMINDERS.md)</h2>
        <ol>{CHECKLIST.map((c) => <li>{c}</li>)}</ol>
      </div>
      <div class="panel">
        <h2>New season</h2>
        <label>Season <input style={{ width: '6em' }} value={season} onInput={(e) => setSeason((e.target as HTMLInputElement).value)} /></label>
        {next && (
          <ul>
            <li>Application IDs: <b>{next.idPrefix}-0001</b>, …</li>
            <li>Sessions (dates moved by a year — check them): {next.sessions.map((s) => `${s.label} from ${s.startDate}`).join('; ')}</li>
            <li>Courses carried over (capacities and prerequisites too — edit them in Season setup): {next.courses.map((c) => c.code).join(', ')}</li>
            <li>Fees, thresholds, payment reference/IBAN, column mapping: carried over.</li>
            <li>Confirmed Flemish schools: carried over.</li>
            <li>Applications, flags, payments, audit log: <b>not</b> carried over (they stay in the archived Sheet).</li>
          </ul>
        )}
        {repo.store.isDemo ? (
          <p class="muted">Not available in the demo (it needs a Google Sheet).</p>
        ) : (
          <button class="primary" disabled={!next || !!busy} onClick={start}>Create season {season} and archive {cur.season}</button>
        )}
        {busy && <p class="muted">{busy}</p>}
        {err && <div class="msg err">{err}</div>}
      </div>
    </div>
  );
}

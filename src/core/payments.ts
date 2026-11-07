import { isActive } from './assign';
import type { ParsedCsv } from './csv';
import { field } from './flags';
import { collapseWs, fold, normEmail } from './text';
import { APP_COLS, PAY_COLS, type Row, type SeasonConfig } from './types';

// ---------------------------------------------------------------- payment CSV columns

export interface PaymentColumns {
  name: string;
  email: string;
  proof: string;
  terms: string;
  /** Optional "This payment is for: Session I / II / both" (recommended form change, REMINDERS.md). */
  session: string;
}

/**
 * Find the payment-form columns by their (stable) beginnings, so the planned label changes
 * ("E-mail address used in the application …") keep working. `termslink` is ignored.
 */
export function findPaymentColumns(headers: string[]): { cols: PaymentColumns; missing: string[] } {
  const h = headers.map((x) => collapseWs(x));
  const find = (re: RegExp) => h.find((x) => re.test(x)) ?? '';
  const cols: PaymentColumns = {
    name: find(/^student (full )?name/i),
    email: find(/e-?mail/i),
    proof: find(/^proof of payment/i),
    terms: find(/^i hereby acknowledge/i),
    session: find(/payment is for|which session/i),
  };
  const missing = (['name', 'email', 'proof'] as const).filter((k) => !cols[k]);
  return { cols, missing };
}

// ---------------------------------------------------------------- name similarity

function lev(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

const tokens = (s: string) => fold(s).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);

/**
 * Similarity of two person names, 0…1: accent/case-insensitive, word order ignored, small typos tolerated.
 * 1.0 = same words. Partial names ("Kato Van Acker" vs "Kato Van Acker-Peeters") score high but below 1.
 */
export function nameScore(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.length || !B.length) return 0;
  const sim = (x: string, y: string) => 1 - lev(x, y) / Math.max(x.length, y.length);
  const best = (xs: string[], ys: string[]) => xs.reduce((s, x) => s + Math.max(...ys.map((y) => sim(x, y))), 0);
  return Math.min(best(A, B), best(B, A)) / Math.max(A.length, B.length);
}

// ---------------------------------------------------------------- matching

export interface MatchResult {
  status: 'matched' | 'open';
  apps: string[];
  method: string;
  /** Top suggestions for a human, best first. */
  candidates: { id: string; score: number; who: string }[];
}

const studentName = (a: Row, cfg: SeasonConfig) => `${field(a, cfg, 'firstName')} ${field(a, cfg, 'surname')}`;

/**
 * Match a payment to an application:
 * 1. e-mail equal (normalised) to the student's or the parent's e-mail → matched, if that gives one application
 *    (or one clearly by name, e.g. siblings sharing a parent e-mail; or the form's session answer decides);
 * 2. otherwise the student or parent name with identical words (accents, case, order ignored) → matched if unique;
 * 3. otherwise open, with the 3 most similar names as suggestions.
 */
export function matchPayment(name: string, email: string, sessionAnswer: string, apps: Row[], cfg: SeasonConfig): MatchResult {
  const pool = apps.filter(isActive);
  const e = normEmail(email);
  const top = (list: Row[]) =>
    list
      .map((a) => {
        const s = nameScore(name, studentName(a, cfg));
        const p = nameScore(name, field(a, cfg, 'parentName'));
        return { id: a[APP_COLS.id], score: Math.round(Math.max(s, p) * 100) / 100, who: p > s ? 'parent' : 'student' };
      })
      .sort((x, y) => y.score - x.score || (x.id < y.id ? -1 : 1));

  const byEmail = e ? pool.filter((a) => normEmail(field(a, cfg, 'email')) === e || normEmail(field(a, cfg, 'parentEmail')) === e) : [];
  if (byEmail.length) {
    const method = byEmail.every((a) => normEmail(field(a, cfg, 'email')) === e) ? 'e-mail (student)' : 'e-mail (student or parent)';
    if (byEmail.length === 1) return { status: 'matched', apps: [byEmail[0][APP_COLS.id]], method, candidates: [] };
    // Several applications with this e-mail: the session answer (if the form has it) or the name may decide.
    const ranked = top(byEmail);
    const sess = sessionKeyFromAnswer(sessionAnswer, cfg);
    if (sess) {
      const s = byEmail.filter((a) => a[APP_COLS.session] === sess);
      if (s.length === 1) return { status: 'matched', apps: [s[0][APP_COLS.id]], method: `${method} + session answer`, candidates: [] };
    }
    if (ranked[0].score >= 0.99 && ranked[1].score < 0.8) return { status: 'matched', apps: [ranked[0].id], method: `${method} + name`, candidates: [] };
    return { status: 'open', apps: [], method: `e-mail matches ${byEmail.length} applications`, candidates: ranked.slice(0, 3) };
  }

  const ranked = top(pool);
  const exact = ranked.filter((r) => r.score >= 0.99);
  const people = new Set(exact.map((r) => personOf(r.id, pool)));
  if (exact.length && people.size === 1 && exact.length === 1)
    return { status: 'matched', apps: [exact[0].id], method: exact[0].who === 'parent' ? 'parent name' : 'student name', candidates: [] };
  return { status: 'open', apps: [], method: exact.length > 1 ? `name matches ${exact.length} applications` : 'no match', candidates: ranked.filter((r) => r.score >= 0.5).slice(0, 3) };
}

function personOf(id: string, apps: Row[]): string {
  const a = apps.find((x) => x[APP_COLS.id] === id);
  return a?.[APP_COLS.personKey] || id;
}

/** "Session I" / "Session II" / "both" answer → session key, or '' (both / unknown / absent). */
export function sessionKeyFromAnswer(answer: string, cfg: SeasonConfig): string {
  const t = collapseWs(answer).toLowerCase();
  if (!t || t.includes('both')) return '';
  const s = cfg.sessions.find((x) => {
    const short = x.label.replace(/\s*\(.*$/, '').toLowerCase();
    return t === short || t.startsWith(`${short} `) || t.startsWith(`${short}(`);
  });
  return s?.key ?? '';
}

// ---------------------------------------------------------------- import plan

export interface PaymentPlan {
  errors: string[];
  warnings: string[];
  totalRows: number;
  alreadyImported: number;
  newRows: Row[];
}

const contentKey = (r: Row, c: PaymentColumns) =>
  [c.name, c.email, c.proof, c.terms, c.session].map((k) => (k ? collapseWs(r[k] ?? '').toLowerCase() : '')).join('\u0001');

/**
 * Plan a payment-CSV import. The export always contains all submissions in the same order and has no
 * timestamp, so a row is recognised by its contents plus its occurrence number among identical rows.
 * A repeated identical submission is kept but marked as a duplicate.
 */
export function planPayments(csv: ParsedCsv, apps: Row[], existing: Row[], cfg: SeasonConfig, importedAt: string): PaymentPlan {
  const plan: PaymentPlan = { errors: [...csv.errors], warnings: [], totalRows: csv.rows.length, alreadyImported: 0, newRows: [] };
  const { cols, missing } = findPaymentColumns(csv.headers);
  if (missing.length) plan.errors.push(`Payment CSV: column(s) not found: ${missing.join(', ')}. Is this the payment-form export?`);
  if (plan.errors.length) return plan;
  if (!cols.session) plan.warnings.push('The payment form has no "which session" question yet: payments of two-session students must be linked by hand.');

  const seen = new Set(existing.map((p) => p[PAY_COLS.importKey]));
  const firstOfContent = new Map<string, string>();
  for (const p of existing) {
    const ck = p[PAY_COLS.importKey].replace(/#\d+$/, '');
    if (!firstOfContent.has(ck) && p[PAY_COLS.status] !== 'duplicate') firstOfContent.set(ck, p[PAY_COLS.paymentId]);
  }
  let n = existing.reduce((m, p) => Math.max(m, parseInt((p[PAY_COLS.paymentId] ?? '').replace(/\D/g, '') || '0', 10)), 0);
  const occurrences = new Map<string, number>();
  for (const r of csv.rows) {
    const ck = contentKey(r.values, cols);
    const occ = (occurrences.get(ck) ?? 0) + 1;
    occurrences.set(ck, occ);
    const key = `${ck}#${occ}`;
    if (seen.has(key)) {
      plan.alreadyImported++;
      continue;
    }
    const id = `P-${String(++n).padStart(4, '0')}`;
    const name = collapseWs(r.values[cols.name] ?? '');
    const email = (r.values[cols.email] ?? '').trim();
    const sessionAnswer = cols.session ? collapseWs(r.values[cols.session] ?? '') : '';
    const row: Row = {
      [PAY_COLS.paymentId]: id,
      [PAY_COLS.importKey]: key,
      [PAY_COLS.importedAt]: importedAt,
      [PAY_COLS.rowNo]: String(r.rowNo),
      [PAY_COLS.payerName]: name,
      [PAY_COLS.payerEmail]: email,
      [PAY_COLS.proofFile]: collapseWs(r.values[cols.proof] ?? ''),
      [PAY_COLS.terms]: cols.terms ? (r.values[cols.terms] ?? '').trim() : '',
      [PAY_COLS.sessionAnswer]: sessionAnswer,
      [PAY_COLS.status]: 'open',
      [PAY_COLS.matchedApps]: '',
      [PAY_COLS.matchMethod]: '',
      [PAY_COLS.candidates]: '',
      [PAY_COLS.duplicateOf]: '',
      [PAY_COLS.proofStatus]: '',
      [PAY_COLS.proofDetail]: '',
      [PAY_COLS.note]: '',
    };
    const first = firstOfContent.get(ck);
    if (first) {
      Object.assign(row, { [PAY_COLS.status]: 'duplicate', [PAY_COLS.duplicateOf]: first, [PAY_COLS.matchMethod]: 'identical submission' });
    } else {
      firstOfContent.set(ck, id);
      const m = matchPayment(name, email, sessionAnswer, apps, cfg);
      Object.assign(row, {
        [PAY_COLS.status]: m.status,
        [PAY_COLS.matchedApps]: m.apps.join(', '),
        [PAY_COLS.matchMethod]: m.method,
        [PAY_COLS.candidates]: m.candidates.map((c) => `${c.id} (${c.score.toFixed(2)}${c.who === 'parent' ? ', parent' : ''})`).join('; '),
      });
    }
    if (cols.terms && row[PAY_COLS.terms] !== 'TRUE') plan.warnings.push(`${id} (${name}): terms and conditions not ticked.`);
    plan.newRows.push(row);
  }
  return plan;
}

/** IDs in a "SOS26-0001, SOS26-0002" cell. */
export const idList = (s: string | undefined) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);

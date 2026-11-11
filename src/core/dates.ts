/**
 * Posting Date/Time looks like "2026/02/15 09:52:32.419897 GMT+1" (GMT+2 in summer time).
 * Returns an ISO-like UTC string with microseconds, e.g. "2026-02-15T08:52:32.419897Z",
 * which sorts correctly as text. Returns null if the format is not recognised.
 */
export function postingToUTC(s: string): string | null {
  // Real exports don't zero-pad every part (e.g. "10:03:9.874100"), so accept 1–2 digits.
  const m = /^\s*(\d{4})[/-](\d{1,2})[/-](\d{1,2})[ T](\d{1,2}):(\d{1,2}):(\d{1,2})(?:\.(\d{1,6}))?\s*(?:GMT|UTC)?\s*([+-]\d{1,2})?(?::?(\d{2}))?\s*$/.exec(s);
  if (!m) return null;
  const [, y, mo, d, h, mi, sec, frac = '', offH = '+0', offM = '00'] = m;
  const sign = offH.startsWith('-') ? -1 : 1;
  const offsetMin = sign * (Math.abs(parseInt(offH, 10)) * 60 + parseInt(offM, 10));
  const ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec) - offsetMin * 60_000;
  const iso = new Date(ms).toISOString().slice(0, 19);
  return `${iso}.${frac.padEnd(6, '0')}Z`;
}

/** Parse a strict yyyy-mm-dd date. Returns null for anything else (e.g. Excel's dd/mm/yyyy). */
export function parseIsoDate(s: string): { y: number; m: number; d: number } | null {
  const mt = /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/.exec(s);
  if (!mt) return null;
  const y = +mt[1], m = +mt[2], d = +mt[3];
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return { y, m, d };
}

/** Age in whole years on a given date (birthday on that date counts). Null if either date is invalid. */
export function ageOn(birth: string, on: string): number | null {
  const b = parseIsoDate(birth);
  const o = parseIsoDate(on);
  if (!b || !o) return null;
  return o.y - b.y - (o.m < b.m || (o.m === b.m && o.d < b.d) ? 1 : 0);
}

export function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------- Belgian calendar dates
// "Today", deadlines and cut-offs are calendar dates in Belgium, not UTC (between 00:00 and 02:00 local time
// the UTC date is still yesterday).

const BXL = 'Europe/Brussels';

/** yyyy-mm-dd in Brussels for an ISO instant (default: now). */
export function brusselsDate(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: BXL, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Offset of Brussels from UTC in minutes at a given instant (+60 in winter, +120 in summer). */
function brusselsOffsetMin(ms: number): number {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: BXL, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms));
  const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
  return (Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - ms) / 60_000;
}

/** The last microsecond of a Brussels calendar day, as a PostingUTC-comparable string ("…T21:59:59.999999Z"). */
export function brusselsEndOfDayUTC(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const localEnd = Date.UTC(y, m - 1, d, 23, 59, 59);
  const ms = localEnd - brusselsOffsetMin(localEnd) * 60_000;
  return `${new Date(ms).toISOString().slice(0, 19)}.999999Z`;
}

/**
 * Posting Date/Time looks like "2026/02/15 09:52:32.419897 GMT+1" (GMT+2 in summer time).
 * Returns an ISO-like UTC string with microseconds, e.g. "2026-02-15T08:52:32.419897Z",
 * which sorts correctly as text. Returns null if the format is not recognised.
 */
export function postingToUTC(s: string): string | null {
  const m = /^\s*(\d{4})[/-](\d{2})[/-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?\s*(?:GMT|UTC)?\s*([+-]\d{1,2})?(?::?(\d{2}))?\s*$/.exec(s);
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

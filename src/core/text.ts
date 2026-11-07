/** Trim and collapse all internal whitespace (incl. line breaks) to single spaces. */
export function collapseWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Remove diacritics, also for letters NFKD doesn't decompose (ł, ø, ß, ı, đ, æ…). */
export function stripAccents(s: string): string {
  const special: Record<string, string> = {
    ł: 'l', Ł: 'L', ø: 'o', Ø: 'O', ß: 'ss', ı: 'i', đ: 'd', Đ: 'D', æ: 'ae', Æ: 'AE', œ: 'oe', Œ: 'OE', þ: 'th', Þ: 'Th',
  };
  return s
    .replace(/[łŁøØßıđĐæÆœŒþÞ]/g, (c) => special[c] ?? c)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '');
}

/** Comparison key: whitespace-collapsed, accent-free, lower case. */
export function fold(s: string): string {
  return stripAccents(collapseWs(s)).toLowerCase();
}

/** Comparison key for e-mail addresses. */
export function normEmail(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase();
}

/** Case-insensitive, whitespace-insensitive equality used for exact-duplicate detection. */
export function sameLoose(a: string, b: string): boolean {
  return collapseWs(a).toLowerCase() === collapseWs(b).toLowerCase();
}

export function wordCount(s: string): number {
  const t = s.trim();
  return t === '' ? 0 : t.split(/\s+/).length;
}

/** Tidy a single-line value for storage/display: trim + collapse spaces. Multi-line text keeps its line breaks. */
export function tidy(s: string): string {
  if (/[\r\n]/.test(s)) return s.replace(/\r\n/g, '\n').trim();
  return collapseWs(s);
}

// Checks on the text of a proof of payment (from OCR of a screenshot, or the text layer of a PDF).
// Pure: the text extraction itself happens in the browser (src/ui/ocr.ts).

export interface ProofExpectation {
  /** Amount(s) that count as correct, e.g. [380] or [760] for two sessions in one transfer. */
  amounts: number[];
  /** Structured reference, e.g. "+++400/0029/31560+++". */
  reference: string;
  iban: string;
}

/** Fixed IBAN length per country (ISO 13616 registry; SEPA countries and the most common others). */
export const IBAN_LENGTHS: Record<string, number> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BR: 29, BY: 28, CH: 21, CR: 22, CY: 28,
  CZ: 24, DE: 22, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18,
  GR: 27, GT: 28, HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32,
  LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MD: 24, ME: 22, MK: 19, MR: 27, MT: 31, MU: 30, NL: 18, NO: 15, PK: 24,
  PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, SA: 24, SC: 31, SE: 24, SI: 19, SK: 24, SM: 27, ST: 25, SV: 28,
  TL: 23, TN: 24, TR: 26, UA: 29, VA: 22, VG: 24, XK: 20,
};

export interface IbanCandidate {
  iban: string;
  /** Up to ~30 characters of text in front of the IBAN on the same line ("Van rekening:", "Begunstigde"…). */
  label: string;
  /** Rough role from the label: the account that paid, the receiving account, or unknown. */
  role: 'payer' | 'beneficiary' | 'unknown';
}

const PAYER_WORDS = /\b(van|from|debit|debet|opdrachtgever|uw rekening|your account|rekening van|donneur|de compte|sender|afzender|payer)\b/i;
const BENEFICIARY_WORDS = /\b(begunstigde|beneficiary|bénéficiaire|beneficiaire|naar|to|aan|recipient|ontvanger|destinataire|creditor|credit)\b/i;

/**
 * Valid IBANs in a text, with the label in front of each. Checked with the ISO 7064 mod-97 digits AND the country's
 * fixed length (so a following word like "JAN PEETERS" can't be glued on); unknown country codes take the shortest
 * valid length. Spaces between groups are allowed.
 */
export function ibanCandidates(text: string): IbanCandidate[] {
  const out = new Map<string, IbanCandidate>();
  const t = text.toUpperCase();
  for (const m of t.matchAll(/\b([A-Z]{2}\d{2}(?: ?[A-Z0-9]){10,30})/g)) {
    const raw = m[1].replace(/ /g, '');
    const cc = raw.slice(0, 2);
    const lens = IBAN_LENGTHS[cc] ? [IBAN_LENGTHS[cc]] : Array.from({ length: 21 }, (_, i) => i + 14);
    const len = lens.find((l) => raw.length >= l && validIban(raw.slice(0, l)));
    if (!len) continue;
    const iban = raw.slice(0, len).replace(/(.{4})(?=.)/g, '$1 ');
    if (out.has(iban)) continue;
    const lineStart = text.lastIndexOf('\n', m.index!) + 1;
    const label = text.slice(Math.max(lineStart, m.index! - 30), m.index!).replace(/\s+/g, ' ').trim();
    const role = BENEFICIARY_WORDS.test(label) ? 'beneficiary' : PAYER_WORDS.test(label) ? 'payer' : 'unknown';
    out.set(iban, { iban, label, role });
  }
  return [...out.values()];
}

/** Valid IBANs in a text (see ibanCandidates). */
export function ibansIn(text: string): string[] {
  return ibanCandidates(text).map((c) => c.iban);
}

export function validIban(iban: string): boolean {
  const s = iban.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const len = IBAN_LENGTHS[s.slice(0, 2)];
  if (len && s.length !== len) return false;
  const re = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let r = 0;
  for (const ch of re) r = (r * 10 + Number(ch)) % 97;
  return r === 1;
}

export interface ProofAnalysis {
  verdict: 'likely-ok' | 'needs-review';
  amountFound: boolean;
  referenceFound: boolean;
  ibanFound: boolean;
  /** Amounts that look like money in the text (for the reviewer). */
  amountsSeen: number[];
  /** IBANs other than the receiving account, most likely payer first. */
  payerIbans: string[];
  /** Every IBAN found, with its label (stored for the reimbursement screen). */
  candidates: IbanCandidate[];
  detail: string;
}

/** All amounts in a text: 380 · 380,00 · 380.00 · € 380 · -380.00 EUR · 1.380,00 · 1,380.00 · 1 380,00. */
export function amountsIn(text: string): number[] {
  return amountMatches(text).map((m) => m.value);
}

/** Amounts with a hint whether they look like money (decimals or a currency sign/code next to them). */
function amountMatches(text: string): { value: number; money: boolean }[] {
  const out = new Map<number, boolean>();
  const re = /(?<![\d/])(€|EUR)?\s?-?\s?(\d{1,3}(?:[.,\s]\d{3})+|\d+)(?:([.,])(\d{2}))?(?![\d/])\s?(€|EUR)?/gi;
  for (const m of text.matchAll(re)) {
    const v = Number(m[2].replace(/[.,\s]/g, '')) + (m[4] ? Number(m[4]) / 100 : 0);
    if (!(v > 0 && v < 100000)) continue;
    const key = Math.round(v * 100) / 100;
    out.set(key, (out.get(key) ?? false) || !!(m[1] || m[4] || m[5]));
  }
  return [...out.entries()].map(([value, money]) => ({ value, money }));
}

export function analyzeProof(text: string, exp: ProofExpectation): ProofAnalysis {
  const candidates = ibanCandidates(text);
  const own = exp.iban.replace(/\s/g, '').toUpperCase();
  // Remove IBANs and the reference before looking for amounts: their digit groups (60, 7340, 400, …) aren't amounts.
  const refDigits = exp.reference.replace(/\D/g, '');
  let scrubbed = text;
  for (const c of candidates) scrubbed = scrubbed.split(c.iban).join(' ').split(c.iban.replace(/ /g, '')).join(' ');
  if (refDigits) scrubbed = scrubbed.replace(new RegExp(refDigits.split('').join('[^0-9]{0,3}'), 'g'), ' ');
  const found = amountMatches(scrubbed);
  // If anything looks like money (decimals, € or EUR), only those count.
  const pool = found.some((f) => f.money) ? found.filter((f) => f.money) : found;
  const amountsSeen = pool.map((f) => f.value);
  const amountFound = exp.amounts.some((a) => amountsSeen.some((s) => Math.abs(s - a) < 0.005));
  const digits = text.replace(/\D/g, '');
  const referenceFound = refDigits.length > 0 && digits.includes(refDigits);
  const ibanFound = own.length > 0 && candidates.some((c) => c.iban.replace(/ /g, '') === own);
  const others = candidates.filter((c) => c.iban.replace(/ /g, '') !== own);
  // A different account labelled as beneficiary: the money may have gone elsewhere.
  const otherBeneficiary = others.find((c) => c.role === 'beneficiary');
  const verdict = amountFound && (referenceFound || ibanFound) && !otherBeneficiary ? 'likely-ok' : 'needs-review';
  const yes = (b: boolean) => (b ? 'found' : 'NOT found');
  const detail =
    `amount ${exp.amounts.join(' or ')} ${yes(amountFound)}; reference ${yes(referenceFound)}; IBAN ${yes(ibanFound)}` +
    (amountFound ? '' : amountsSeen.length ? ` (amounts seen: ${amountsSeen.slice(0, 6).join(', ')})` : ' (no amounts recognised)') +
    (otherBeneficiary ? `; ATTENTION: beneficiary account ${otherBeneficiary.iban} is not KU Leuven's` : '');
  const payerIbans = [...others.filter((c) => c.role === 'payer'), ...others.filter((c) => c.role === 'unknown')].map((c) => c.iban);
  return { verdict, amountFound, referenceFound, ibanFound, amountsSeen, payerIbans, candidates, detail };
}

export type Pairing = { kind: 'paired'; file: number } | { kind: 'ambiguous'; files: number[] } | { kind: 'missing' };

/**
 * Pair dropped proof files with payment rows by file name (case-insensitive). A saved file may carry a prefix:
 * - with the payer's e-mail (recommended naming when saving the attachments: "<e-mail>__<original name>"), the
 *   file belongs to that payment even if many payments share "payment.jpg";
 * - any other prefix (e.g. a date) is allowed, but then pairing is automatic only when exactly one payment and one
 *   file share the name; with "screenshot.png" × 5 the human picks per payment.
 */
export function pairProofFiles(payments: { id: string; proofFile: string; email?: string }[], fileNames: string[]): Map<string, Pairing> {
  const norm = (s: string) => s.trim().toLowerCase();
  const filesFor = (proof: string) =>
    fileNames.map((f, i) => ({ f: norm(f), i })).filter(({ f }) => proof && (f === norm(proof) || f.endsWith(` ${norm(proof)}`) || f.endsWith(`_${norm(proof)}`))).map((x) => x.i);
  const sameName = (proof: string) => payments.filter((p) => norm(p.proofFile) === norm(proof)).length;
  const out = new Map<string, Pairing>();
  for (const p of payments) {
    const files = filesFor(p.proofFile);
    const e = norm(p.email ?? '').replace(/\s+/g, '');
    const withEmail = e ? files.filter((i) => norm(fileNames[i]).includes(e)) : [];
    const sameEmailAndName = payments.filter((q) => norm(q.email ?? '').replace(/\s+/g, '') === e && norm(q.proofFile) === norm(p.proofFile)).length;
    if (withEmail.length === 1 && sameEmailAndName === 1) out.set(p.id, { kind: 'paired', file: withEmail[0] });
    else if (files.length === 0) out.set(p.id, { kind: 'missing' });
    else if (files.length === 1 && sameName(p.proofFile) === 1) out.set(p.id, { kind: 'paired', file: files[0] });
    else out.set(p.id, { kind: 'ambiguous', files });
  }
  return out;
}

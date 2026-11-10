// Checks on the text of a proof of payment (from OCR of a screenshot, or the text layer of a PDF).
// Pure: the text extraction itself happens in the browser (src/ui/ocr.ts).

export interface ProofExpectation {
  /** Amount(s) that count as correct, e.g. [380] or [760] for two sessions in one transfer. */
  amounts: number[];
  /** Structured reference, e.g. "+++400/0029/31560+++". */
  reference: string;
  iban: string;
}

/** Valid IBANs in a text (spaces allowed; checked with the ISO 7064 mod-97 check digits). */
export function ibansIn(text: string): string[] {
  const out = new Set<string>();
  const t = text.toUpperCase().replace(/[^A-Z0-9 \n]/g, ' ');
  for (const m of t.matchAll(/\b([A-Z]{2}\d{2}(?: ?[A-Z0-9]){10,30})/g)) {
    const raw = m[1].replace(/ /g, '');
    // Try the longest prefix first (OCR may glue the next word on).
    for (let len = Math.min(raw.length, 34); len >= 14; len--) {
      const iban = raw.slice(0, len);
      if (validIban(iban)) {
        out.add(iban.replace(/(.{4})(?=.)/g, '$1 '));
        break;
      }
    }
  }
  return [...out];
}

export function validIban(iban: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const re = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
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
  /** IBANs in the text other than the receiving account: probably the account the payment came from. */
  payerIbans: string[];
  detail: string;
}

/** All amounts in a text: 380 · 380,00 · 380.00 · € 380 · -380.00 EUR · 1.380,00 · 1,380.00 · 1 380,00. */
export function amountsIn(text: string): number[] {
  const out = new Set<number>();
  const re = /(?<![\d/])-?\s?(\d{1,3}(?:[.,\s]\d{3})+|\d+)(?:([.,])(\d{2}))?(?![\d/])/g;
  for (const m of text.matchAll(re)) {
    const whole = m[1].replace(/[.,\s]/g, '');
    const v = Number(whole) + (m[3] ? Number(m[3]) / 100 : 0);
    if (v > 0 && v < 100000) out.add(Math.round(v * 100) / 100);
  }
  return [...out];
}

export function analyzeProof(text: string, exp: ProofExpectation): ProofAnalysis {
  const amountsSeen = amountsIn(text);
  const amountFound = exp.amounts.some((a) => amountsSeen.some((s) => Math.abs(s - a) < 0.005));
  const digits = text.replace(/\D/g, '');
  const refDigits = exp.reference.replace(/\D/g, '');
  const referenceFound = refDigits.length > 0 && digits.includes(refDigits);
  const compact = text.replace(/\s/g, '').toUpperCase();
  const ibanFound = exp.iban.length > 0 && compact.includes(exp.iban.replace(/\s/g, '').toUpperCase());
  const verdict = amountFound && (referenceFound || ibanFound) ? 'likely-ok' : 'needs-review';
  const yes = (b: boolean) => (b ? 'found' : 'NOT found');
  const detail =
    `amount ${exp.amounts.join(' or ')} ${yes(amountFound)}; reference ${yes(referenceFound)}; IBAN ${yes(ibanFound)}` +
    (amountFound ? '' : amountsSeen.length ? ` (amounts seen: ${amountsSeen.slice(0, 6).join(', ')})` : ' (no amounts recognised)');
  const own = exp.iban.replace(/\s/g, '').toUpperCase();
  const payerIbans = ibansIn(text).filter((i) => i.replace(/\s/g, '') !== own);
  return { verdict, amountFound, referenceFound, ibanFound, amountsSeen, payerIbans, detail };
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

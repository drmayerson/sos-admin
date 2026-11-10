// Course roster PDFs: one page per student ("student card"), made in this browser with jsPDF.
// The DejaVu Sans font is bundled with the app (no font is fetched from elsewhere) so names like Ştefan or Łukasz print.
import type { jsPDF as JsPDF } from 'jspdf';
import type { StudentCard } from '../core/rosters';
import regularUrl from 'dejavu-fonts-ttf/ttf/DejaVuSans.ttf?url';
import boldUrl from 'dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf?url';

async function fontBase64(url: string): Promise<string> {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

let fonts: Promise<[string, string]> | null = null;

async function newDoc(): Promise<JsPDF> {
  const { jsPDF } = await import('jspdf');
  fonts ??= Promise.all([fontBase64(regularUrl), fontBase64(boldUrl)]);
  const [reg, bold] = await fonts;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  doc.addFileToVFS('DejaVuSans.ttf', reg);
  doc.addFont('DejaVuSans.ttf', 'DejaVu', 'normal');
  doc.addFileToVFS('DejaVuSans-Bold.ttf', bold);
  doc.addFont('DejaVuSans-Bold.ttf', 'DejaVu', 'bold');
  doc.setFont('DejaVu', 'normal');
  return doc;
}

const M = 15; // page margin (mm)
const LABEL_W = 62;

function drawCard(doc: JsPDF, card: StudentCard) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const W = pageW - 2 * M;
  let y = M;
  doc.setLineWidth(0.25);

  // Title row
  doc.setFont('DejaVu', 'bold');
  doc.setFontSize(11);
  doc.rect(M, y, W, 7);
  doc.text(card.title, pageW / 2, y + 5, { align: 'center' });
  y += 7;

  // Field rows (label | value), wrapped
  doc.setFontSize(10);
  for (const [label, value] of card.rows) {
    doc.setFont('DejaVu', 'normal');
    const lines = doc.splitTextToSize(value || '', W - LABEL_W - 3) as string[];
    const h = Math.max(6, lines.length * 4.6 + 1.6);
    doc.rect(M, y, LABEL_W, h);
    doc.rect(M + LABEL_W, y, W - LABEL_W, h);
    doc.setFont('DejaVu', 'bold');
    doc.text(label, M + 1.5, y + 4.4);
    doc.setFont('DejaVu', 'normal');
    doc.text(lines, M + LABEL_W + 1.5, y + 4.4);
    y += h;
  }

  // Motivation: header + text, shrinking the font to fit the page (down to 7 pt), else continuing on new pages.
  y += 6;
  doc.setFont('DejaVu', 'bold');
  doc.setFontSize(10);
  doc.rect(M, y, W, 6);
  doc.text('Motivation', M + 1.5, y + 4.3);
  y += 6;
  doc.setFont('DejaVu', 'normal');
  const avail = pageH - M - y - 2;
  let size = 10;
  let lines: string[] = [];
  const lineH = (s: number) => s * 0.43;
  for (; size >= 7; size -= 0.5) {
    doc.setFontSize(size);
    lines = doc.splitTextToSize(card.motivation || '', W - 3) as string[];
    if (lines.length * lineH(size) <= avail) break;
  }
  size = Math.max(size, 7);
  doc.setFontSize(size);
  const perFirst = Math.max(1, Math.floor(avail / lineH(size)));
  const perNext = Math.max(1, Math.floor((pageH - 2 * M - 2) / lineH(size)));
  let i = 0;
  let firstPage = true;
  for (;;) {
    const cap = firstPage ? perFirst : perNext;
    const chunk = lines.slice(i, i + cap);
    if (!firstPage) {
      doc.addPage();
      y = M;
    }
    const h = Math.max(8, chunk.length * lineH(size) + 3);
    doc.rect(M, y, W, h);
    if (chunk.length) doc.text(chunk, M + 1.5, y + lineH(size) + 0.5);
    i += cap;
    firstPage = false;
    if (i >= lines.length) break;
  }
}

/** One PDF with a page per student card. */
export async function rosterPdf(cards: StudentCard[]): Promise<Blob> {
  const doc = await newDoc();
  cards.forEach((c, i) => {
    if (i > 0) doc.addPage();
    drawCard(doc, c);
  });
  if (cards.length === 0) {
    doc.setFontSize(12);
    doc.text('No students.', M, M + 10);
  }
  return doc.output('blob');
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadText(text: string, filename: string, type = 'text/plain'): void {
  downloadBlob(new Blob([text], { type: `${type};charset=utf-8` }), filename);
}

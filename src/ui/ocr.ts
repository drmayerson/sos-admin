// Text extraction from proof-of-payment files, entirely in this browser:
// - PDFs: the text layer via pdf.js; scanned PDFs (no text) are rendered and OCR'd;
// - images: OCR with Tesseract.js.
// The OCR engine and language data are served by this app itself (public/ocr/, see scripts/copy-ocr.mjs);
// nothing about the files leaves the browser. Libraries are loaded only when first needed.
import type { Worker } from 'tesseract.js';

let worker: Promise<Worker> | null = null;

function ocrWorker(): Promise<Worker> {
  worker ??= (async () => {
    const { createWorker, OEM } = await import('tesseract.js');
    const base = `${import.meta.env.BASE_URL}ocr/`;
    const simd = typeof WebAssembly === 'object' && WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
    return createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: `${base}worker.min.js`,
      corePath: `${base}${simd ? 'tesseract-core-simd-lstm.wasm.js' : 'tesseract-core-lstm.wasm.js'}`,
      langPath: base.replace(/\/$/, ''),
      gzip: true,
      workerBlobURL: false,
    });
  })();
  return worker;
}

async function ocrImage(img: Blob | HTMLCanvasElement): Promise<string> {
  const w = await ocrWorker();
  const { data } = await w.recognize(img);
  return data.text;
}

async function pdfText(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    if (name === 'PasswordException') throw new Error(`${file.name}: the PDF is password-protected — check this proof by hand.`);
    if (name === 'InvalidPDFException') throw new Error(`${file.name}: not a valid PDF (damaged?) — check this proof by hand.`);
    throw e;
  }
  const pages = Math.min(doc.numPages, 3);
  let text = '';
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => ('str' in it ? it.str : '')).join(' ') + '\n';
  }
  if (text.replace(/\s/g, '').length >= 20) return text;
  // Scanned PDF: render pages and OCR them.
  let ocr = '';
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
    ocr += (await ocrImage(canvas)) + '\n';
  }
  return ocr;
}

export async function extractText(file: File): Promise<{ text: string; how: string }> {
  // iPhone photos: browsers can't decode HEIC, so text recognition would fail with an obscure error.
  if (/^image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name))
    throw new Error(`${file.name}: iPhone HEIC photo — the browser can't read it. Open it, save as JPG/PNG (or check it by hand).`);
  if (file.type.startsWith('image/')) return { text: await ocrImage(file), how: 'text recognition' };
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return { text: await pdfText(file), how: 'PDF' };
  if (/\.(png|jpe?g|gif|bmp|webp)$/i.test(file.name)) return { text: await ocrImage(file), how: 'text recognition' };
  throw new Error(`${file.name}: not an image or PDF — check this proof by hand.`);
}

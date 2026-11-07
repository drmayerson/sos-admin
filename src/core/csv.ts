import Papa from 'papaparse';
import { normHeader } from './headers';
import type { Row } from './types';

export interface DecodeResult {
  ok: boolean;
  text: string;
  hadBom: boolean;
  /** Blocking problem (file must not be imported). */
  error?: string;
}

/**
 * Decode an uploaded file as strict UTF-8. Files re-saved by Excel are usually Windows-1252,
 * which is not valid UTF-8 → refuse, because non-Western characters are already lost.
 */
export function decodeUtf8(bytes: Uint8Array): DecodeResult {
  const hadBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
    if (text.includes('�')) {
      return { ok: false, text, hadBom, error: 'The file contains replacement characters (�): some characters were lost. Please download the original export again.' };
    }
    return { ok: true, text, hadBom };
  } catch {
    return {
      ok: false,
      text: '',
      hadBom,
      error:
        'This file is not valid UTF-8. It was probably opened and saved in Excel, which damages non-Western characters. ' +
        'Please download the original CSV from the website again and upload it without opening it in Excel.',
    };
  }
}

export interface ParsedCsv {
  /** Original header text (as in the file). */
  headers: string[];
  /** Rows keyed by whitespace-normalised header; values exactly as in the file. */
  rows: { rowNo: number; values: Row }[];
  blankRows: number;
  errors: string[];
}

/** Parse a `;`-separated export with quoted multi-line fields. Fully empty rows are skipped and counted. */
export function parseCsv(text: string, delimiter = ';'): ParsedCsv {
  const res = Papa.parse<string[]>(text.replace(/^﻿/, ''), { delimiter, skipEmptyLines: false });
  const data = res.data;
  const errors = res.errors
    .filter((e) => e.code !== 'UndetectableDelimiter')
    .map((e) => `Row ${(e.row ?? 0) + 1}: ${e.message}`);
  if (data.length === 0) return { headers: [], rows: [], blankRows: 0, errors: ['The file is empty.'] };
  const headers = data[0];
  const keys = headers.map(normHeader);
  const rows: ParsedCsv['rows'] = [];
  let blankRows = 0;
  for (let i = 1; i < data.length; i++) {
    const cells = data[i];
    if (cells.every((c) => c.trim() === '')) {
      // Papa yields [''] for the final newline; don't count that as a blank row.
      if (!(i === data.length - 1 && cells.length === 1)) blankRows++;
      continue;
    }
    if (cells.length !== headers.length) errors.push(`Row ${i + 1}: expected ${headers.length} columns, found ${cells.length}.`);
    const values: Row = {};
    keys.forEach((k, j) => (values[k] = cells[j] ?? ''));
    rows.push({ rowNo: i + 1, values });
  }
  return { headers, rows, blankRows, errors };
}

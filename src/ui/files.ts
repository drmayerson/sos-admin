// Helpers to hand the user a file (JSON packet or Excel). Files are created in the browser; nothing is uploaded.

export function downloadJson(obj: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** One workbook with one sheet per entry (SheetJS is loaded only when needed). */
export async function downloadWorkbook(sheets: { sheet: string; rows: object[] }[], filename: string): Promise<void> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.rows.length ? s.rows : [{ '(empty)': '' }]), s.sheet.replace(/[\/?*[\]:]/g, ' ').slice(0, 31));
  XLSX.writeFile(wb, filename);
}

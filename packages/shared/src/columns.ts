/**
 * Spreadsheet column-letter <-> 0-based index conversions.
 *
 * Used by the sheets module on both API (for validation/range computation)
 * and worker (for reading/writing ranges via Google Sheets A1 notation).
 *
 *   colLetterToIndex('A')  === 0
 *   colLetterToIndex('Z')  === 25
 *   colLetterToIndex('AA') === 26
 *   indexToColLetter(0)    === 'A'
 *   indexToColLetter(26)   === 'AA'
 */

export function colLetterToIndex(letter: string): number {
  const upper = letter.toUpperCase();
  if (!/^[A-Z]+$/.test(upper)) {
    throw new Error(`Invalid column letter: "${letter}"`);
  }
  let index = 0;
  for (let i = 0; i < upper.length; i++) {
    index = index * 26 + (upper.charCodeAt(i) - 64);
  }
  return index - 1;
}

export function indexToColLetter(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid column index: ${index}`);
  }
  let n = index + 1;
  let result = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

/** Add `delta` to a column letter and return the new letter. */
export function offsetColLetter(letter: string, delta: number): string {
  return indexToColLetter(colLetterToIndex(letter) + delta);
}

/**
 * Build a Google Sheets A1 range like "Sheet1!A2:B" — open-ended on rows.
 */
export function buildA1Range(opts: {
  sheetName?: string | null;
  fromCol: string;
  toCol: string;
  fromRow: number;
  toRow?: number | null;
}): string {
  const prefix = opts.sheetName ? `'${opts.sheetName.replace(/'/g, "''")}'!` : '';
  const tail = opts.toRow ? `${opts.toCol}${opts.toRow}` : `${opts.toCol}`;
  return `${prefix}${opts.fromCol}${opts.fromRow}:${tail}`;
}

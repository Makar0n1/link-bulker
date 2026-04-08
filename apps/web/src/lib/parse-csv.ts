import Papa from 'papaparse';
import type { ManualLinkInput } from './api';
import { isValidDonorUrl, extractAcceptorHost } from '@link-checker/shared';

export interface ParsedRow {
  rowIndex: number;
  donorUrl: string;
  acceptor: string;
  errors: string[];
}

export interface ParseResult {
  rows: ParsedRow[];
  validCount: number;
  invalidCount: number;
}

/**
 * Parse a CSV file from AddLinksDialog into typed rows with validation.
 *
 * Convention: column A = donorUrl, column B = acceptor.
 * If `hasHeader` is true, the first row is skipped.
 *
 * Each row is validated client-side using the same helpers the API uses,
 * so the user gets immediate feedback before submitting.
 */
export async function parseLinksCsv(file: File, hasHeader: boolean): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(file, {
      skipEmptyLines: true,
      header: false,
      complete: (results) => {
        const data = (results.data as string[][]) ?? [];
        const start = hasHeader ? 1 : 0;
        const rows: ParsedRow[] = data.slice(start).map((cols, idx) =>
          validateRow(idx + start + 1, cols[0] ?? '', cols[1] ?? ''),
        );
        const validCount = rows.filter((r) => r.errors.length === 0).length;
        resolve({ rows, validCount, invalidCount: rows.length - validCount });
      },
      error: (err) => reject(err),
    });
  });
}

/**
 * Validate raw textarea/csv input. Exposed separately so unit tests don't
 * need real File objects.
 */
export function validateRow(rowIndex: number, rawDonor: string, rawAcceptor: string): ParsedRow {
  const donorUrl = (rawDonor ?? '').trim();
  const acceptor = (rawAcceptor ?? '').trim();
  const errors: string[] = [];

  if (!donorUrl) errors.push('donorUrl is empty');
  else if (!isValidDonorUrl(donorUrl)) errors.push('donorUrl must be a valid http(s) URL');

  if (!acceptor) {
    errors.push('acceptor is empty');
  } else {
    try {
      extractAcceptorHost(acceptor);
    } catch (err) {
      errors.push(`acceptor invalid: ${(err as Error).message}`);
    }
  }

  return { rowIndex, donorUrl, acceptor, errors };
}

/**
 * Convert parsed rows into the API submission shape, dropping invalid rows.
 */
export function rowsToPayload(rows: ParsedRow[]): ManualLinkInput[] {
  return rows
    .filter((r) => r.errors.length === 0)
    .map((r) => ({ donorUrl: r.donorUrl, acceptor: r.acceptor }));
}

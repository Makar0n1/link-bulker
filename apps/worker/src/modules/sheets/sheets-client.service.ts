import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { buildA1Range } from '@link-checker/shared';
import { loadEnv } from '../../config/env';

/**
 * Thin wrapper around the Google Sheets v4 API.
 *
 * Auth: a single service account JSON key shared by every project. The key
 * is loaded from GOOGLE_SERVICE_ACCOUNT_PATH (file) or
 * GOOGLE_SERVICE_ACCOUNT_JSON (inline) at first use. The user must share
 * each spreadsheet with the service account's email — we expose that email
 * to the UI so the user can copy it.
 *
 * Sheet identification: callers pass the numeric `sheetGid` (the value of
 * the `gid` query parameter in the Google Sheets URL). gid is stable across
 * renames; the title is resolved on demand via `resolveSheetTitle`.
 */

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  [k: string]: unknown;
}

export interface ReadSheetParams {
  spreadsheetId: string;
  /** Resolved sheet title (use resolveSheetTitle to get this from a gid). */
  sheetTitle: string | null;
  donorColumn: string;
  acceptorColumn: string;
  dataStartRow: number;
}

export interface SheetRow {
  rowNumber: number;
  donorUrl: string;
  acceptor: string;
}

export interface WriteValuesParams {
  spreadsheetId: string;
  /** A1 destination range, e.g. "'Sheet1'!C2:H100" */
  range: string;
  values: Array<Array<string | number | null>>;
}

@Injectable()
export class SheetsClientService {
  private readonly logger = new Logger(SheetsClientService.name);
  private clientPromise: Promise<any> | null = null;
  private cachedKey: ServiceAccountKey | null = null;

  getServiceAccountEmail(): string {
    const env = loadEnv();
    if (env.GOOGLE_SERVICE_ACCOUNT_EMAIL) return env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const key = this.loadKeyFromEnv();
    return key.client_email;
  }

  private loadKeyFromEnv(): ServiceAccountKey {
    if (this.cachedKey) return this.cachedKey;
    const env = loadEnv();

    if (env.GOOGLE_SERVICE_ACCOUNT_PATH) {
      try {
        const raw = readFileSync(env.GOOGLE_SERVICE_ACCOUNT_PATH, 'utf-8');
        this.cachedKey = JSON.parse(raw) as ServiceAccountKey;
        return this.cachedKey;
      } catch (err) {
        throw new Error(
          `Failed to read GOOGLE_SERVICE_ACCOUNT_PATH at "${env.GOOGLE_SERVICE_ACCOUNT_PATH}": ${
            (err as Error).message
          }`,
        );
      }
    }
    if (env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      try {
        this.cachedKey = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) as ServiceAccountKey;
        return this.cachedKey;
      } catch (err) {
        throw new Error(
          `Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON: ${(err as Error).message}`,
        );
      }
    }
    throw new Error(
      'Google Sheets is not configured: set GOOGLE_SERVICE_ACCOUNT_PATH or GOOGLE_SERVICE_ACCOUNT_JSON',
    );
  }

  private async getClient(): Promise<any> {
    if (this.clientPromise) return this.clientPromise;
    const key = this.loadKeyFromEnv();
    this.clientPromise = (async () => {
      const { google } = await import('googleapis');
      const auth = new google.auth.JWT({
        email: key.client_email,
        key: key.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
      await auth.authorize();
      return google.sheets({ version: 'v4', auth });
    })();
    return this.clientPromise;
  }

  /**
   * Look up a sheet's title by its numeric gid. Calls
   * `spreadsheets.get(fields=sheets.properties)` once per spreadsheet.
   *
   * Returns null if the gid does not exist in this spreadsheet, in which
   * case the caller should fail the run with a clear error.
   */
  async resolveSheetTitle(spreadsheetId: string, sheetGid: number): Promise<string | null> {
    const client = await this.getClient();
    const res = await client.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties(sheetId,title)',
    });
    const sheets = (res.data.sheets ?? []) as Array<{
      properties?: { sheetId?: number; title?: string };
    }>;
    const found = sheets.find((s) => s.properties?.sheetId === sheetGid);
    return found?.properties?.title ?? null;
  }

  async readDonorRows(params: ReadSheetParams): Promise<SheetRow[]> {
    const client = await this.getClient();

    const donorRange = buildA1Range({
      sheetName: params.sheetTitle ?? null,
      fromCol: params.donorColumn,
      toCol: params.donorColumn,
      fromRow: params.dataStartRow,
    });
    const acceptorRange = buildA1Range({
      sheetName: params.sheetTitle ?? null,
      fromCol: params.acceptorColumn,
      toCol: params.acceptorColumn,
      fromRow: params.dataStartRow,
    });

    const result = await client.spreadsheets.values.batchGet({
      spreadsheetId: params.spreadsheetId,
      ranges: [donorRange, acceptorRange],
      valueRenderOption: 'UNFORMATTED_VALUE',
    });

    const valueRanges = result.data.valueRanges ?? [];
    const donorValues: any[][] = valueRanges[0]?.values ?? [];
    const acceptorValues: any[][] = valueRanges[1]?.values ?? [];

    const rows: SheetRow[] = [];
    const length = Math.max(donorValues.length, acceptorValues.length);
    for (let i = 0; i < length; i++) {
      const donorUrl = String(donorValues[i]?.[0] ?? '').trim();
      const acceptor = String(acceptorValues[i]?.[0] ?? '').trim();
      if (!donorUrl && !acceptor) continue;
      rows.push({
        rowNumber: params.dataStartRow + i,
        donorUrl,
        acceptor,
      });
    }
    return rows;
  }

  async writeValues(params: WriteValuesParams): Promise<void> {
    const client = await this.getClient();
    await client.spreadsheets.values.update({
      spreadsheetId: params.spreadsheetId,
      range: params.range,
      valueInputOption: 'RAW',
      requestBody: { values: params.values },
    });
  }

  /**
   * Write a 2-D matrix of formatted cells via spreadsheets.batchUpdate /
   * updateCells. This is a single API call that sets values, background,
   * foreground, alignment and bold for the entire block — far more efficient
   * than per-cell repeatCell requests.
   *
   * The block is positioned in (sheetId, startRowIndex, startColumnIndex)
   * using zero-based indices (sheetId == sheetGid).
   */
  async writeFormattedBlock(params: {
    spreadsheetId: string;
    sheetId: number;
    startRowIndex: number;
    startColumnIndex: number;
    cells: FormattedCell[][];
  }): Promise<void> {
    const { spreadsheetId, sheetId, startRowIndex, startColumnIndex, cells } = params;
    if (cells.length === 0) return;

    const client = await this.getClient();

    const rows = cells.map((row) => ({
      values: row.map((cell) => buildCellData(cell)),
    }));

    await client.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            updateCells: {
              start: {
                sheetId,
                rowIndex: startRowIndex,
                columnIndex: startColumnIndex,
              },
              rows,
              fields:
                'userEnteredValue,userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat,wrapStrategy)',
            },
          },
        ],
      },
    });
  }

  /**
   * Set fixed pixel widths on a contiguous range of columns starting at
   * `startColumnIndex` (zero-based). Used after writeFormattedBlock so the
   * result columns get sensible widths matching the content.
   */
  async setColumnWidths(params: {
    spreadsheetId: string;
    sheetId: number;
    startColumnIndex: number;
    widths: number[];
  }): Promise<void> {
    const { spreadsheetId, sheetId, startColumnIndex, widths } = params;
    if (widths.length === 0) return;
    const client = await this.getClient();

    const requests = widths.map((width, i) => ({
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: 'COLUMNS',
          startIndex: startColumnIndex + i,
          endIndex: startColumnIndex + i + 1,
        },
        properties: { pixelSize: width },
        fields: 'pixelSize',
      },
    }));

    await client.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });
  }
}

// ────────────────────────────────────────────────────────────────────────
// Formatted cell helpers
// ────────────────────────────────────────────────────────────────────────

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/**
 * Single formatted cell payload accepted by writeFormattedBlock.
 * All format fields are optional. `value` becomes the cell content.
 */
export interface FormattedCell {
  value: string | number | null;
  bgColor?: RGB;
  textColor?: RGB;
  bold?: boolean;
  /** Defaults to CENTER. */
  horizontalAlignment?: 'LEFT' | 'CENTER' | 'RIGHT';
}

function buildCellData(cell: FormattedCell): any {
  const userEnteredValue =
    cell.value === null
      ? {}
      : typeof cell.value === 'number'
        ? { numberValue: cell.value }
        : { stringValue: cell.value };

  const textFormat: any = {};
  if (cell.textColor) textFormat.foregroundColor = toGoogleColor(cell.textColor);
  if (cell.bold) textFormat.bold = true;

  const userEnteredFormat: any = {
    horizontalAlignment: cell.horizontalAlignment ?? 'CENTER',
    verticalAlignment: 'MIDDLE',
    wrapStrategy: 'CLIP',
  };
  if (cell.bgColor) userEnteredFormat.backgroundColor = toGoogleColor(cell.bgColor);
  if (Object.keys(textFormat).length > 0) userEnteredFormat.textFormat = textFormat;

  return { userEnteredValue, userEnteredFormat };
}

function toGoogleColor({ r, g, b }: RGB): { red: number; green: number; blue: number } {
  return { red: r, green: g, blue: b };
}

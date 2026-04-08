import type {
  FormattedCell,
  SheetRow,
} from '../../src/modules/sheets/sheets-client.service';

/**
 * In-memory replacement for SheetsClientService used in worker tests.
 *
 * Tests seed `rowsToReturn` (or use the default) and then inspect:
 *   - `writes` for legacy writeValues calls (kept for backwards compat)
 *   - `formattedWrites` for writeFormattedBlock calls
 *   - `columnWidths` for setColumnWidths calls
 */
export class MockSheetsClient {
  rowsToReturn: SheetRow[];
  writes: Array<{ spreadsheetId: string; range: string; values: any[][] }> = [];
  formattedWrites: Array<{
    spreadsheetId: string;
    sheetId: number;
    startRowIndex: number;
    startColumnIndex: number;
    cells: FormattedCell[][];
  }> = [];
  columnWidths: Array<{
    spreadsheetId: string;
    sheetId: number;
    startColumnIndex: number;
    widths: number[];
  }> = [];
  serviceAccountEmail = 'mock-sa@example.com';

  constructor(rowsToReturn: SheetRow[] = []) {
    this.rowsToReturn = rowsToReturn;
  }

  getServiceAccountEmail(): string {
    return this.serviceAccountEmail;
  }

  async resolveSheetTitle(_spreadsheetId: string, _sheetGid: number): Promise<string | null> {
    return 'Sheet1';
  }

  async readDonorRows(): Promise<SheetRow[]> {
    return this.rowsToReturn;
  }

  async writeValues(params: {
    spreadsheetId: string;
    range: string;
    values: any[][];
  }): Promise<void> {
    this.writes.push(params);
  }

  async writeFormattedBlock(params: {
    spreadsheetId: string;
    sheetId: number;
    startRowIndex: number;
    startColumnIndex: number;
    cells: FormattedCell[][];
  }): Promise<void> {
    this.formattedWrites.push(params);
  }

  async setColumnWidths(params: {
    spreadsheetId: string;
    sheetId: number;
    startColumnIndex: number;
    widths: number[];
  }): Promise<void> {
    this.columnWidths.push(params);
  }
}

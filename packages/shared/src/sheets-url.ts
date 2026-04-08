/**
 * Parse a Google Sheets URL into its spreadsheet id and sheet (tab) gid.
 *
 * Accepted shapes:
 *   https://docs.google.com/spreadsheets/d/{ID}/edit#gid=0
 *   https://docs.google.com/spreadsheets/d/{ID}/edit?gid=123#gid=123
 *   https://docs.google.com/spreadsheets/d/{ID}/edit
 *   {ID}                          (bare id, gid defaults to 0)
 *
 * Returns null if the input cannot be parsed.
 */
export interface ParsedSheetUrl {
  spreadsheetId: string;
  sheetGid: number;
}

const SPREADSHEET_ID_RE = /\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/;
const BARE_ID_RE = /^([a-zA-Z0-9_-]{20,})$/;
const GID_RE = /[?#&]gid=(\d+)/;

export function parseSheetUrl(input: string): ParsedSheetUrl | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Bare id case
  const bare = BARE_ID_RE.exec(trimmed);
  if (bare) {
    return { spreadsheetId: bare[1]!, sheetGid: 0 };
  }

  const idMatch = SPREADSHEET_ID_RE.exec(trimmed);
  if (!idMatch) return null;
  const spreadsheetId = idMatch[1]!;

  const gidMatch = GID_RE.exec(trimmed);
  const sheetGid = gidMatch ? Number(gidMatch[1]) : 0;
  if (!Number.isFinite(sheetGid) || sheetGid < 0) return null;

  return { spreadsheetId, sheetGid };
}

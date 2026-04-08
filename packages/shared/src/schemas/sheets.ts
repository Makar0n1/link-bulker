import { z } from 'zod';

const ColumnLetter = z
  .string()
  .regex(/^[A-Z]{1,3}$/, 'Column must be uppercase letters only, e.g. "A" or "AB"');

export const CreateSheetsTaskInput = z.object({
  name: z.string().min(1).max(120),
  spreadsheetId: z.string().min(1).max(200),
  // The numeric `gid` of the sheet (tab) inside the spreadsheet. 0 = first
  // sheet by default. The frontend extracts both spreadsheetId and sheetGid
  // from a Google Sheets URL via parseSheetUrl().
  sheetGid: z.number().int().min(0).default(0),
  donorColumn: ColumnLetter,
  acceptorColumn: ColumnLetter,
  resultStartCol: ColumnLetter,
  headerRow: z.number().int().min(0).max(10).default(1),
  dataStartRow: z.number().int().min(1).max(1000).default(2),
  scheduleCron: z.string().max(120).optional(),
});
export type CreateSheetsTaskInput = z.infer<typeof CreateSheetsTaskInput>;

export const UpdateSheetsTaskInput = CreateSheetsTaskInput.partial();
export type UpdateSheetsTaskInput = z.infer<typeof UpdateSheetsTaskInput>;

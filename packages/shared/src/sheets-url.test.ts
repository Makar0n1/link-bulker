import { describe, expect, it } from 'vitest';
import { parseSheetUrl } from './sheets-url';

describe('parseSheetUrl', () => {
  it('parses a full URL with gid in fragment', () => {
    expect(
      parseSheetUrl('https://docs.google.com/spreadsheets/d/1sES6oWKc1Q7royHPbsV_O6SRO6LNc9eG-3Yv1O0Sz9I/edit?gid=0#gid=0'),
    ).toEqual({
      spreadsheetId: '1sES6oWKc1Q7royHPbsV_O6SRO6LNc9eG-3Yv1O0Sz9I',
      sheetGid: 0,
    });
  });

  it('parses a URL with non-zero gid', () => {
    expect(
      parseSheetUrl('https://docs.google.com/spreadsheets/d/abcdefghij1234567890/edit#gid=12345'),
    ).toEqual({ spreadsheetId: 'abcdefghij1234567890', sheetGid: 12345 });
  });

  it('parses a URL without gid (defaults to 0)', () => {
    expect(parseSheetUrl('https://docs.google.com/spreadsheets/d/abcdefghij1234567890/edit')).toEqual({
      spreadsheetId: 'abcdefghij1234567890',
      sheetGid: 0,
    });
  });

  it('parses a bare spreadsheet id', () => {
    expect(parseSheetUrl('1sES6oWKc1Q7royHPbsV_O6SRO6LNc9eG-3Yv1O0Sz9I')).toEqual({
      spreadsheetId: '1sES6oWKc1Q7royHPbsV_O6SRO6LNc9eG-3Yv1O0Sz9I',
      sheetGid: 0,
    });
  });

  it('trims whitespace', () => {
    expect(parseSheetUrl('   abcdefghij1234567890   ')).toEqual({
      spreadsheetId: 'abcdefghij1234567890',
      sheetGid: 0,
    });
  });

  it('returns null for empty input', () => {
    expect(parseSheetUrl('')).toBeNull();
    expect(parseSheetUrl('   ')).toBeNull();
  });

  it('returns null for invalid URL', () => {
    expect(parseSheetUrl('https://example.com/something')).toBeNull();
  });

  it('returns null for too-short id', () => {
    expect(parseSheetUrl('short')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { buildA1Range, colLetterToIndex, indexToColLetter, offsetColLetter } from './columns';

describe('colLetterToIndex', () => {
  it('A → 0', () => expect(colLetterToIndex('A')).toBe(0));
  it('Z → 25', () => expect(colLetterToIndex('Z')).toBe(25));
  it('AA → 26', () => expect(colLetterToIndex('AA')).toBe(26));
  it('AZ → 51', () => expect(colLetterToIndex('AZ')).toBe(51));
  it('BA → 52', () => expect(colLetterToIndex('BA')).toBe(52));
  it('case insensitive', () => expect(colLetterToIndex('aa')).toBe(26));
  it('throws on invalid', () => expect(() => colLetterToIndex('A1')).toThrow());
});

describe('indexToColLetter', () => {
  it('0 → A', () => expect(indexToColLetter(0)).toBe('A'));
  it('25 → Z', () => expect(indexToColLetter(25)).toBe('Z'));
  it('26 → AA', () => expect(indexToColLetter(26)).toBe('AA'));
  it('51 → AZ', () => expect(indexToColLetter(51)).toBe('AZ'));
  it('throws on negative', () => expect(() => indexToColLetter(-1)).toThrow());
});

describe('offsetColLetter', () => {
  it('A + 2 = C', () => expect(offsetColLetter('A', 2)).toBe('C'));
  it('Z + 1 = AA', () => expect(offsetColLetter('Z', 1)).toBe('AA'));
  it('AA + 1 = AB', () => expect(offsetColLetter('AA', 1)).toBe('AB'));
});

describe('buildA1Range', () => {
  it('without sheet name', () => {
    expect(buildA1Range({ fromCol: 'A', toCol: 'B', fromRow: 2 })).toBe('A2:B');
  });
  it('with sheet name', () => {
    expect(
      buildA1Range({ sheetName: 'Data', fromCol: 'A', toCol: 'B', fromRow: 2, toRow: 100 }),
    ).toBe(`'Data'!A2:B100`);
  });
  it('escapes single quotes in sheet name', () => {
    expect(
      buildA1Range({ sheetName: "John's", fromCol: 'A', toCol: 'A', fromRow: 1 }),
    ).toBe(`'John''s'!A1:A`);
  });
});

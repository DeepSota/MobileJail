import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { FILE_FORMAT_REGISTRY } from '../system/FileManager/viewer/fileFormatRegistry';
import {
  isPasswordProtectedOfficeFile,
  matchesSpreadsheetFileSignature,
} from '../system/FileManager/viewer/officeFileInspection';
import { classifyPdfLoadError } from '../system/FileManager/viewer/pdfError';
import {
  buildSpreadsheetGrid,
  findActiveSpreadsheetCell,
} from '../system/FileManager/viewer/spreadsheetModel';
import {
  decodeTextBytes,
  TextDecodingError,
} from '../system/FileManager/viewer/textDecoding';
import {
  VIEWER_SIZE_LIMITS,
  validateViewerSourceSize,
} from '../system/FileManager/viewer/viewerValidation';

function encryptedOfficeEnvelope(): Uint8Array {
  return new Uint8Array(Buffer.concat([
    Buffer.from('d0cf11e0a1b11ae1', 'hex'),
    Buffer.alloc(64),
    Buffer.from('EncryptionInfo', 'utf16le'),
    Buffer.alloc(32),
    Buffer.from('EncryptedPackage', 'utf16le'),
  ]));
}

describe('FileManager viewer pure models', () => {
  it('decodes UTF-8 BOM, UTF-16 BOMs, and GB18030 with an encoding label', () => {
    expect(decodeTextBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]))).toEqual({
      text: 'hi', encoding: 'UTF-8', hadBom: true,
    });
    expect(decodeTextBytes(new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x2d, 0x4e]))).toEqual({
      text: 'A中', encoding: 'UTF-16 LE', hadBom: true,
    });
    expect(decodeTextBytes(new Uint8Array([0xfe, 0xff, 0x00, 0x41, 0x4e, 0x2d]))).toEqual({
      text: 'A中', encoding: 'UTF-16 BE', hadBom: true,
    });
    expect(decodeTextBytes(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]))).toEqual({
      text: '中文', encoding: 'GB18030', hadBom: false,
    });
    expect(() => decodeTextBytes(new Uint8Array([0x81]))).toThrow(TextDecodingError);
    expect(() => decodeTextBytes(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toThrow(TextDecodingError);
  });

  it('keeps worksheet formulas and resolves the URL-selected cell', () => {
    const sheet = XLSX.utils.aoa_to_sheet([[1, 2, 3]]);
    sheet.C1 = { t: 'n', v: 3, w: '3', f: 'A1+B1' };
    const rows = buildSpreadsheetGrid(sheet, XLSX.utils, 100, 20);

    expect(rows[0][2]).toEqual({ address: 'C1', display: '3', formula: '=A1+B1' });
    expect(findActiveSpreadsheetCell(rows, 'c1')?.formula).toBe('=A1+B1');
    expect(findActiveSpreadsheetCell(rows, 'Z99')?.address).toBe('A1');
  });

  it('classifies password-protected PDF and Office inputs independently', () => {
    expect(classifyPdfLoadError({ name: 'PasswordException' })).toBe('password-protected');
    expect(classifyPdfLoadError({ name: 'InvalidPDFException' })).toBe('corrupted');
    expect(isPasswordProtectedOfficeFile(encryptedOfficeEnvelope())).toBe(true);
    expect(isPasswordProtectedOfficeFile(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 1, 0]))).toBe(true);
  });

  it('rejects renamed text while accepting real XLS and XLSX workbook containers', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['name', 'value'], ['A', 1]]), 'Sheet1');
    const xlsx = new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }));
    const xls = new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'biff8' }));
    const renamedCsv = new TextEncoder().encode('name,value\nA,1\n');

    expect(matchesSpreadsheetFileSignature(xlsx, 'xlsx')).toBe(true);
    expect(matchesSpreadsheetFileSignature(xls, 'xls')).toBe(true);
    expect(matchesSpreadsheetFileSignature(renamedCsv, 'xlsx')).toBe(false);
    expect(matchesSpreadsheetFileSignature(renamedCsv, 'xls')).toBe(false);
  });

  it('uses adapter-specific empty and oversized limits', () => {
    expect(validateViewerSourceSize(0, FILE_FORMAT_REGISTRY.pdf)).toBe('empty');
    expect(validateViewerSourceSize(VIEWER_SIZE_LIMITS.pdf + 1, FILE_FORMAT_REGISTRY.pdf)).toBe('too-large');
    expect(validateViewerSourceSize(VIEWER_SIZE_LIMITS.text, FILE_FORMAT_REGISTRY.txt)).toBe('ok');
    expect(validateViewerSourceSize(VIEWER_SIZE_LIMITS.text + 1, FILE_FORMAT_REGISTRY.txt)).toBe('too-large');
    expect(validateViewerSourceSize(VIEWER_SIZE_LIMITS.spreadsheet + 1, FILE_FORMAT_REGISTRY.xlsx)).toBe('too-large');
  });
});

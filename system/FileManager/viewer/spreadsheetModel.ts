import type { WorkSheet } from 'xlsx';

export interface SpreadsheetCell {
  address: string;
  display: string;
  formula: string;
}

type SheetUtils = Pick<typeof import('xlsx')['utils'], 'decode_range' | 'encode_cell'>;

export function buildSpreadsheetGrid(
  sheet: WorkSheet | undefined,
  utils: SheetUtils,
  maxRows: number,
  maxColumns: number,
): SpreadsheetCell[][] {
  if (!sheet?.['!ref']) return [];
  const range = utils.decode_range(sheet['!ref']);
  const rowCount = Math.min(maxRows, range.e.r + 1);
  const columnCount = Math.min(maxColumns, range.e.c + 1);
  return Array.from({ length: rowCount }, (_, rowIndex) =>
    Array.from({ length: columnCount }, (_, columnIndex) => {
      const address = utils.encode_cell({ r: rowIndex, c: columnIndex });
      const source = sheet[address];
      return {
        address,
        display: source?.w ?? (source?.v == null ? '' : String(source.v)),
        formula: source?.f ? `=${source.f}` : '',
      };
    }),
  );
}

export function findActiveSpreadsheetCell(
  rows: readonly (readonly SpreadsheetCell[])[],
  requestedCell: string,
): SpreadsheetCell | null {
  const normalized = requestedCell.trim().toUpperCase();
  const cells = rows.flat();
  return cells.find(cell => cell.address === normalized) ?? cells[0] ?? null;
}


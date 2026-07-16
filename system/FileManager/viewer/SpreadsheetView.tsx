import React, { useEffect, useMemo, useState } from 'react';
import type { WorkBook } from 'xlsx';
import { IcZoomIn, IcZoomOut } from '../res/icons';
import { useFileManagerGestures } from '../hooks/useFileManagerGestures';
import { useAppStrings } from '@/os/useAppStrings';
import { strings } from '../res/strings';
import { stringsEn } from '../res/strings.en';
import type { FileFormatDescriptor } from './fileFormatRegistry';
import {
  isPasswordProtectedOfficeFile,
  matchesSpreadsheetFileSignature,
} from './officeFileInspection';
import {
  buildSpreadsheetGrid,
  findActiveSpreadsheetCell,
  type SpreadsheetCell,
} from './spreadsheetModel';
import type { ViewerStateReporter } from './viewerState';

interface SpreadsheetViewProps {
  blob: Blob;
  zoomPercent: number;
  searchQuery: string;
  requestedSheet: string;
  requestedCell: string;
  format: FileFormatDescriptor;
  onStateChange: ViewerStateReporter;
}

const MAX_RENDERED_ROWS = 2_000;
const MAX_RENDERED_COLUMNS = 128;

function columnName(index: number): string {
  let value = index + 1;
  let name = '';
  while (value > 0) {
    const digit = (value - 1) % 26;
    name = String.fromCharCode(65 + digit) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

const HighlightedCell: React.FC<{ value: string; query: string }> = ({ value, query }) => {
  const needle = query.trim();
  if (!needle) return <>{value}</>;
  const index = value.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
  if (index < 0) return <>{value}</>;
  return (
    <>
      {value.slice(0, index)}
      <mark className="rounded-[2px] bg-yellow-300 text-inherit">
        {value.slice(index, index + needle.length)}
      </mark>
      {value.slice(index + needle.length)}
    </>
  );
};

export const SpreadsheetView: React.FC<SpreadsheetViewProps> = ({
  blob,
  zoomPercent,
  searchQuery,
  requestedSheet,
  requestedCell,
  format,
  onStateChange,
}) => {
  const s = useAppStrings(strings, stringsEn);
  const { bindTap } = useFileManagerGestures();
  const [workbook, setWorkbook] = useState<WorkBook | null>(null);
  const [loadError, setLoadError] = useState<'corrupted' | 'password-protected' | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);

  useEffect(() => {
    if (loadError === 'password-protected') {
      onStateChange('password-protected');
      return;
    }
    if (loadError) {
      onStateChange('corrupted');
      return;
    }
    if (!workbook) {
      onStateChange('loading');
      return;
    }
    onStateChange(workbook.SheetNames.length === 0 ? 'empty' : 'ready');
  }, [loadError, onStateChange, workbook]);

  useEffect(() => {
    let cancelled = false;
    setWorkbook(null);
    setLoadError(null);
    async function loadWorkbook() {
      const [bytes, XLSX] = await Promise.all([blob.arrayBuffer(), import('xlsx')]);
      const sourceBytes = new Uint8Array(bytes);
      if (isPasswordProtectedOfficeFile(sourceBytes)) {
        if (!cancelled) setLoadError('password-protected');
        return;
      }
      if (!matchesSpreadsheetFileSignature(sourceBytes, format.extension)) {
        if (!cancelled) setLoadError('corrupted');
        return;
      }
      const nextWorkbook = XLSX.read(bytes, {
        type: 'array',
        cellDates: false,
        cellFormula: true,
        cellText: true,
      });
      if (!cancelled) {
        sheetUtils = XLSX.utils;
        setWorkbook(nextWorkbook);
      }
    }
    loadWorkbook().catch(error => {
      if (!cancelled) {
        console.error('[FileManager] Spreadsheet load failed:', error);
        setLoadError('corrupted');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [blob, format.extension, retryVersion]);

  const activeSheetName = useMemo(() => {
    if (!workbook) return '';
    return workbook.SheetNames.includes(requestedSheet)
      ? requestedSheet
      : workbook.SheetNames[0] || '';
  }, [requestedSheet, workbook]);

  const rows = useMemo(() => {
    if (!workbook || !activeSheetName) return [] as SpreadsheetCell[][];
    const sheet = workbook.Sheets[activeSheetName];
    const XLSX = requireSheetUtils(workbook);
    return buildSpreadsheetGrid(sheet, XLSX, MAX_RENDERED_ROWS, MAX_RENDERED_COLUMNS);
  }, [activeSheetName, workbook]);

  const columnCount = useMemo(
    () => Math.min(MAX_RENDERED_COLUMNS, rows.reduce((max, row) => Math.max(max, row.length), 0)),
    [rows],
  );
  const activeCell = useMemo(() => {
    return findActiveSpreadsheetCell(rows, requestedCell);
  }, [requestedCell, rows]);
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const matchCount = useMemo(() => {
    if (!normalizedQuery) return 0;
    return rows.reduce(
      (total, row) => total + row.filter(cell => cell.display.toLocaleLowerCase().includes(normalizedQuery)).length,
      0,
    );
  }, [normalizedQuery, rows]);

  if (loadError) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-10 text-center">
        <div className="text-[16px] font-semibold text-app-text">
          {loadError === 'password-protected' ? s.viewer_error_password_title : s.viewer_error_spreadsheet}
        </div>
        <div className="mt-2 text-[13px] leading-5 text-gray-500">
          {loadError === 'password-protected' ? s.viewer_error_password : s.viewer_error_damaged}
        </div>
        {loadError !== 'password-protected' && (
          <button
            type="button"
            onClick={() => setRetryVersion(version => version + 1)}
            data-action="viewer.file.retry"
            data-action-type="tap"
            className="mt-5 rounded-full bg-app-primary px-6 py-2.5 text-[14px] font-semibold text-white active:opacity-80"
          >
            {s.viewer_retry}
          </button>
        )}
      </div>
    );
  }

  if (!workbook) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-[14px] text-gray-500">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-gray-200 border-t-app-primary" />
        {s.viewer_rendering_spreadsheet}
      </div>
    );
  }

  if (workbook.SheetNames.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-10 text-center">
        <div className="text-[16px] font-semibold text-app-text">{s.viewer_error_empty_title}</div>
        <div className="mt-2 text-[13px] leading-5 text-gray-500">{s.viewer_error_empty}</div>
      </div>
    );
  }

  const zoomOut = Math.max(50, zoomPercent - 25);
  const zoomIn = Math.min(200, zoomPercent + 25);
  const cellWidth = 112 * (zoomPercent / 100);
  const rowHeight = 34 * (zoomPercent / 100);
  const fontSize = 13 * (zoomPercent / 100);

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      {normalizedQuery && (
        <div className="shrink-0 border-b border-black/5 bg-[#fff7d8] px-4 py-2 text-[12px] text-[#6f5a16]">
          {matchCount > 0 ? `${matchCount}${s.viewer_search_cells_suffix}` : s.viewer_search_no_results}
        </div>
      )}
      <div className="flex h-[42px] shrink-0 items-center border-b border-[#d9dde2] bg-white">
        <div
          className="flex h-full w-[72px] shrink-0 items-center justify-center border-r border-[#d9dde2] text-[12px] font-medium text-gray-700"
          aria-label={s.viewer_name_box_label}
        >
          {activeCell?.address ?? 'A1'}
        </div>
        <div className="flex h-full w-10 shrink-0 items-center justify-center border-r border-[#d9dde2] font-serif text-[15px] italic text-gray-500">
          fx
        </div>
        <div
          className="min-w-0 flex-1 truncate px-3 text-[13px] text-gray-700"
          aria-label={s.viewer_formula_bar_label}
        >
          {activeCell?.formula || activeCell?.display || ''}
        </div>
      </div>
      <div
        className="min-h-0 flex-1 overflow-auto overscroll-contain bg-[#f5f6f7]"
        data-scroll-container="main"
        data-scroll-direction="vertical"
      >
        {rows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[14px] text-gray-400">
            {s.viewer_empty_sheet}
          </div>
        ) : (
          <table className="border-separate border-spacing-0 bg-white text-left" style={{ fontSize }}>
            <thead className="sticky top-0 z-20">
              <tr>
                <th
                  className="sticky left-0 z-30 border-b border-r border-[#d9dde2] bg-[#eef0f2] text-center font-normal text-gray-400"
                  style={{ width: 44, minWidth: 44, height: rowHeight }}
                />
                {Array.from({ length: columnCount }, (_, index) => (
                  <th
                    key={index}
                    className="border-b border-r border-[#d9dde2] bg-[#eef0f2] px-2 text-center font-medium text-gray-500"
                    style={{ width: cellWidth, minWidth: cellWidth, height: rowHeight }}
                  >
                    {columnName(index)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  <th
                    className="sticky left-0 z-10 border-b border-r border-[#d9dde2] bg-[#eef0f2] text-center font-normal text-gray-500"
                    style={{ width: 44, minWidth: 44, height: rowHeight }}
                  >
                    {rowIndex + 1}
                  </th>
                  {Array.from({ length: columnCount }, (_, columnIndex) => {
                    const cell = row[columnIndex] || {
                      address: `${columnName(columnIndex)}${rowIndex + 1}`,
                      display: '',
                      formula: '',
                    };
                    const matched = normalizedQuery && cell.display.toLocaleLowerCase().includes(normalizedQuery);
                    const selected = activeCell?.address === cell.address;
                    return (
                      <td
                        key={columnIndex}
                        {...bindTap('viewer.cell.select', {
                          params: { cell: cell.address },
                          mode: 'replace',
                        })}
                        className={`relative max-w-0 overflow-hidden border-b border-r border-[#e2e5e8] px-2.5 align-middle ${
                          matched ? 'bg-yellow-50' : 'bg-white'
                        }`}
                        style={{ width: cellWidth, minWidth: cellWidth, height: rowHeight }}
                        title={cell.formula || cell.display}
                      >
                        {selected && (
                          <span className="pointer-events-none absolute inset-[-1px] z-10 border-2 border-[#217346]" />
                        )}
                        <div className="truncate">
                          <HighlightedCell value={cell.display} query={searchQuery} />
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex h-[48px] shrink-0 items-center border-t border-black/10 bg-[#f8f9fa]">
        <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto px-2">
          {workbook.SheetNames.map(sheetName => (
            <button
              key={sheetName}
              type="button"
              {...bindTap('viewer.sheet.select', { params: { sheet: sheetName }, mode: 'replace' })}
              className={`relative shrink-0 px-4 text-[13px] font-medium ${
                sheetName === activeSheetName ? 'text-[#217346]' : 'text-gray-500'
              }`}
            >
              {sheetName}
              {sheetName === activeSheetName && (
                <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-[#217346]" />
              )}
            </button>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-1 border-l border-black/10 bg-white px-2">
          <button
            type="button"
            disabled={zoomPercent <= 50}
            {...bindTap('viewer.zoom.set', { params: { zoom: zoomOut }, mode: 'replace' })}
            className="flex h-8 w-8 items-center justify-center rounded-full active:bg-gray-100 disabled:opacity-30"
            aria-label={s.viewer_zoom_out}
          >
            <IcZoomOut size={18} />
          </button>
          <span className="w-10 text-center text-[11px] tabular-nums text-gray-500">{zoomPercent}%</span>
          <button
            type="button"
            disabled={zoomPercent >= 200}
            {...bindTap('viewer.zoom.set', { params: { zoom: zoomIn }, mode: 'replace' })}
            className="flex h-8 w-8 items-center justify-center rounded-full active:bg-gray-100 disabled:opacity-30"
            aria-label={s.viewer_zoom_in}
          >
            <IcZoomIn size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * SheetJS' utility object is not stored on the WorkBook value. The loader keeps
 * this module-level reference in sync before publishing the parsed workbook.
 */
let sheetUtils: typeof import('xlsx')['utils'] | null = null;

function requireSheetUtils(workbook: WorkBook): typeof import('xlsx')['utils'] {
  if (sheetUtils) return sheetUtils;
  throw new Error(`SheetJS utilities missing for workbook with ${workbook.SheetNames.length} sheets`);
}

export default SpreadsheetView;

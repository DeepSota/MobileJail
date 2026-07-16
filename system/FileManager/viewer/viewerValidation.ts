import type { FileFormatDescriptor } from './fileFormatRegistry';

export const VIEWER_SIZE_LIMITS = Object.freeze({
  text: 10 * 1024 * 1024,
  pdf: 50 * 1024 * 1024,
  spreadsheet: 25 * 1024 * 1024,
  office: 25 * 1024 * 1024,
});

export type ViewerSourceValidation = 'ok' | 'empty' | 'too-large';

export function getViewerSizeLimit(format: FileFormatDescriptor): number {
  if (format.adapter === 'text') return VIEWER_SIZE_LIMITS.text;
  if (format.adapter === 'pdf') return VIEWER_SIZE_LIMITS.pdf;
  if (format.adapter === 'spreadsheet') return VIEWER_SIZE_LIMITS.spreadsheet;
  if (format.adapter === 'office-page') return VIEWER_SIZE_LIMITS.office;
  return 0;
}

export function validateViewerSourceSize(
  size: number,
  format: FileFormatDescriptor,
): ViewerSourceValidation {
  if (!Number.isFinite(size) || size <= 0) return 'empty';
  const limit = getViewerSizeLimit(format);
  return limit > 0 && size > limit ? 'too-large' : 'ok';
}


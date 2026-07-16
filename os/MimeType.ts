/**
 * MIME helpers shared by the file-sharing and Intent resolution layers.
 *
 * Android MIME matching is an intersection check: either the filter or the
 * requested type may contain a wildcard.  Keeping that rule in one place
 * prevents the chooser and explicit Intent paths from disagreeing.
 */

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  txt: 'text/plain',
  text: 'text/plain',
  log: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  htm: 'text/html',
  md: 'text/markdown',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  heic: 'image/heic',
  heif: 'image/heif',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  tar: 'application/x-tar',
  gz: 'application/gzip',
};

export function normalizeMimeType(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.split(';', 1)[0].trim().toLowerCase();
  if (!normalized || !normalized.includes('/')) return null;
  return normalized;
}

export function inferMimeType(
  fileNameOrPath: string,
  hint?: string | null,
): string {
  const normalizedHint = normalizeMimeType(hint);
  if (normalizedHint && normalizedHint !== 'application/octet-stream' && normalizedHint !== '*/*') {
    return normalizedHint;
  }

  const cleanName = String(fileNameOrPath ?? '').split(/[?#]/, 1)[0];
  const extension = cleanName.includes('.')
    ? cleanName.slice(cleanName.lastIndexOf('.') + 1).toLowerCase()
    : '';
  return MIME_BY_EXTENSION[extension] ?? normalizedHint ?? 'application/octet-stream';
}

function splitMimeType(value: string): [string, string] | null {
  const normalized = normalizeMimeType(value);
  if (!normalized) return null;
  const [major, subtype] = normalized.split('/', 2);
  if (!major || !subtype) return null;
  return [major, subtype];
}

/** Return true when a declared filter and requested Intent MIME overlap. */
export function mimeTypesMatch(
  filterType: string | undefined,
  intentType: string | undefined,
): boolean {
  if (!filterType) return true;
  if (!intentType) return false;

  const filter = splitMimeType(filterType);
  const intent = splitMimeType(intentType);
  if (!filter || !intent) return false;

  const majorMatches = filter[0] === '*' || intent[0] === '*' || filter[0] === intent[0];
  const subtypeMatches = filter[1] === '*' || intent[1] === '*' || filter[1] === intent[1];
  return majorMatches && subtypeMatches;
}

/** Find the narrowest useful MIME shared by a group of files. */
export function commonMimeType(types: readonly string[]): string {
  const normalized = types
    .map((type) => normalizeMimeType(type))
    .filter((type): type is string => Boolean(type));
  if (normalized.length === 0) return 'application/octet-stream';
  if (normalized.every((type) => type === normalized[0])) return normalized[0];

  const majors = normalized.map((type) => type.split('/', 1)[0]);
  if (majors.every((major) => major === majors[0])) return `${majors[0]}/*`;
  return '*/*';
}


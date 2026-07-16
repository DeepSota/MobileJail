import type { FSNode } from '@/os/types';

export type FileViewerKind =
  | 'pdf'
  | 'text'
  | 'word'
  | 'spreadsheet'
  | 'presentation'
  | 'unsupported';

export type FileViewerAdapter =
  | 'pdf'
  | 'text'
  | 'office-page'
  | 'spreadsheet'
  | 'none';

export type FileSignatureKind = 'pdf' | 'text' | 'zip' | 'ole' | 'none';

export interface FileViewerCapabilities {
  search: boolean;
  zoom: boolean;
  thumbnails: boolean;
  sheets: boolean;
  share: boolean;
}

/**
 * A single, extension-specific entry in the File Manager format registry.
 *
 * Extension matching is authoritative. MIME matching is deliberately only a
 * fallback for files without a registered extension; this keeps a JSON or CSV
 * file from accidentally entering the text viewer just because its MIME starts
 * with `text/`.
 */
export interface FileFormatDescriptor {
  kind: FileViewerKind;
  extension: string;
  mime: string;
  mimeTypes: readonly string[];
  adapter: FileViewerAdapter;
  signature: FileSignatureKind;
  supported: boolean;
  colorLabel: string;
  iconLabel: string;
  capabilities: FileViewerCapabilities;
}

const sharedCapabilities = {
  share: true,
} as const;

function descriptor(
  value: Omit<FileFormatDescriptor, 'capabilities'> & {
    capabilities: Omit<FileViewerCapabilities, 'share'>;
  },
): FileFormatDescriptor {
  return Object.freeze({
    ...value,
    mimeTypes: Object.freeze([...value.mimeTypes]),
    capabilities: Object.freeze({
      ...value.capabilities,
      ...sharedCapabilities,
    }),
  });
}

export const FILE_FORMAT_REGISTRY: Readonly<Record<string, FileFormatDescriptor>> = Object.freeze({
  pdf: descriptor({
    kind: 'pdf',
    extension: 'pdf',
    mime: 'application/pdf',
    mimeTypes: ['application/pdf', 'application/x-pdf'],
    adapter: 'pdf',
    signature: 'pdf',
    supported: true,
    colorLabel: '#d64545',
    iconLabel: 'PDF',
    capabilities: { search: true, zoom: true, thumbnails: true, sheets: false },
  }),
  txt: descriptor({
    kind: 'text',
    extension: 'txt',
    mime: 'text/plain',
    mimeTypes: ['text/plain'],
    adapter: 'text',
    signature: 'text',
    supported: true,
    colorLabel: '#5f6672',
    iconLabel: 'TXT',
    capabilities: { search: true, zoom: true, thumbnails: false, sheets: false },
  }),
  log: descriptor({
    kind: 'text',
    extension: 'log',
    mime: 'text/plain',
    mimeTypes: ['text/x-log', 'application/log'],
    adapter: 'text',
    signature: 'text',
    supported: true,
    colorLabel: '#4b5563',
    iconLabel: 'LOG',
    capabilities: { search: true, zoom: true, thumbnails: false, sheets: false },
  }),
  doc: descriptor({
    kind: 'word',
    extension: 'doc',
    mime: 'application/msword',
    mimeTypes: ['application/msword'],
    adapter: 'office-page',
    signature: 'ole',
    supported: true,
    colorLabel: '#2b579a',
    iconLabel: 'W',
    capabilities: { search: true, zoom: true, thumbnails: true, sheets: false },
  }),
  docx: descriptor({
    kind: 'word',
    extension: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    adapter: 'office-page',
    signature: 'zip',
    supported: true,
    colorLabel: '#2b579a',
    iconLabel: 'W',
    capabilities: { search: true, zoom: true, thumbnails: true, sheets: false },
  }),
  xls: descriptor({
    kind: 'spreadsheet',
    extension: 'xls',
    mime: 'application/vnd.ms-excel',
    mimeTypes: ['application/vnd.ms-excel'],
    adapter: 'spreadsheet',
    signature: 'ole',
    supported: true,
    colorLabel: '#217346',
    iconLabel: 'X',
    capabilities: { search: true, zoom: true, thumbnails: false, sheets: true },
  }),
  xlsx: descriptor({
    kind: 'spreadsheet',
    extension: 'xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    adapter: 'spreadsheet',
    signature: 'zip',
    supported: true,
    colorLabel: '#217346',
    iconLabel: 'X',
    capabilities: { search: true, zoom: true, thumbnails: false, sheets: true },
  }),
  ppt: descriptor({
    kind: 'presentation',
    extension: 'ppt',
    mime: 'application/vnd.ms-powerpoint',
    mimeTypes: ['application/vnd.ms-powerpoint'],
    adapter: 'office-page',
    signature: 'ole',
    supported: true,
    colorLabel: '#d24726',
    iconLabel: 'P',
    capabilities: { search: true, zoom: true, thumbnails: true, sheets: false },
  }),
  pptx: descriptor({
    kind: 'presentation',
    extension: 'pptx',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    mimeTypes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    adapter: 'office-page',
    signature: 'zip',
    supported: true,
    colorLabel: '#d24726',
    iconLabel: 'P',
    capabilities: { search: true, zoom: true, thumbnails: true, sheets: false },
  }),
  md: descriptor({
    kind: 'unsupported',
    extension: 'md',
    mime: 'text/markdown',
    mimeTypes: ['text/markdown', 'text/x-markdown'],
    adapter: 'none',
    signature: 'none',
    supported: false,
    colorLabel: '#6b7280',
    iconLabel: 'MD',
    capabilities: { search: false, zoom: false, thumbnails: false, sheets: false },
  }),
  json: descriptor({
    kind: 'unsupported',
    extension: 'json',
    mime: 'application/json',
    mimeTypes: ['application/json', 'text/json'],
    adapter: 'none',
    signature: 'none',
    supported: false,
    colorLabel: '#6b7280',
    iconLabel: 'JSON',
    capabilities: { search: false, zoom: false, thumbnails: false, sheets: false },
  }),
  csv: descriptor({
    kind: 'unsupported',
    extension: 'csv',
    mime: 'text/csv',
    mimeTypes: ['text/csv', 'application/csv'],
    adapter: 'none',
    signature: 'none',
    supported: false,
    colorLabel: '#6b7280',
    iconLabel: 'CSV',
    capabilities: { search: false, zoom: false, thumbnails: false, sheets: false },
  }),
});

const MIME_FALLBACK_REGISTRY = new Map<string, FileFormatDescriptor>();
for (const format of Object.values(FILE_FORMAT_REGISTRY)) {
  for (const mime of format.mimeTypes) {
    // Keep the first registered meaning of an ambiguous MIME such as text/plain.
    if (!MIME_FALLBACK_REGISTRY.has(mime)) {
      MIME_FALLBACK_REGISTRY.set(mime, format);
    }
  }
}

const UNKNOWN_FORMAT: FileFormatDescriptor = descriptor({
  kind: 'unsupported',
  extension: '',
  mime: 'application/octet-stream',
  mimeTypes: [],
  adapter: 'none',
  signature: 'none',
  supported: false,
  colorLabel: '#6b7280',
  iconLabel: 'FILE',
  capabilities: { search: false, zoom: false, thumbnails: false, sheets: false },
});

type FileIdentity = Pick<FSNode, 'name' | 'mimeType'>;

export function getFileExtension(file: string | Pick<FSNode, 'name'>): string {
  const name = typeof file === 'string' ? file : file.name;
  const leaf = name.split(/[\\/]/).pop() ?? '';
  const dotIndex = leaf.lastIndexOf('.');
  if (dotIndex < 0 || dotIndex === leaf.length - 1) return '';
  return leaf.slice(dotIndex + 1).toLowerCase();
}

export function classifyFileFormat(
  file: string | FileIdentity,
  fallbackMimeType?: string,
): FileFormatDescriptor {
  const extension = getFileExtension(file);
  const byExtension = FILE_FORMAT_REGISTRY[extension];
  if (byExtension) return byExtension;

  // A present but unknown extension is authoritative.  MIME fallback is only
  // safe for extensionless files; otherwise `payload.exe` labelled text/plain
  // could be routed into a document renderer.
  if (extension) return Object.freeze({ ...UNKNOWN_FORMAT, extension });

  const mimeType = (typeof file === 'string' ? fallbackMimeType : file.mimeType)?.toLowerCase().trim();
  const byMime = mimeType ? MIME_FALLBACK_REGISTRY.get(mimeType) : undefined;
  if (byMime) {
    return extension && extension !== byMime.extension
      ? Object.freeze({ ...byMime, extension })
      : byMime;
  }

  return UNKNOWN_FORMAT;
}

export function isSupportedDocument(file: string | FileIdentity, mimeType?: string): boolean {
  return classifyFileFormat(file, mimeType).supported;
}

/** Returns true for both supported viewer formats and the explicit MD/JSON/CSV rejection set. */
export function isDocumentLikeFile(node: FSNode): boolean {
  if (node.type !== 'file') return false;
  const extension = getFileExtension(node);
  if (extension in FILE_FORMAT_REGISTRY) return true;
  const mimeType = node.mimeType?.toLowerCase().trim();
  return Boolean(mimeType && MIME_FALLBACK_REGISTRY.has(mimeType));
}

export const SUPPORTED_DOCUMENT_EXTENSIONS = Object.freeze(
  Object.values(FILE_FORMAT_REGISTRY)
    .filter(format => format.supported)
    .map(format => format.extension),
);

export const UNSUPPORTED_DOCUMENT_EXTENSIONS = Object.freeze(
  Object.values(FILE_FORMAT_REGISTRY)
    .filter(format => !format.supported)
    .map(format => format.extension),
);

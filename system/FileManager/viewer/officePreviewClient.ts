import { netFetch } from '@/os/NetworkService';
import type { FileFormatDescriptor } from './fileFormatRegistry';
import { isPasswordProtectedOfficeFile } from './officeFileInspection';

export const OFFICE_PREVIEW_ENDPOINT = '/api/preview/office';
export const OFFICE_PREVIEW_MAX_BYTES = 25 * 1024 * 1024;

export type OfficePreviewErrorCode =
  | 'MISSING_EXTENSION'
  | 'UNSUPPORTED_EXTENSION'
  | 'FILE_TOO_LARGE'
  | 'PASSWORD_PROTECTED'
  | 'INVALID_FILE'
  | 'CONVERSION_FAILED'
  | 'PREVIEW_BUSY'
  | 'SERVICE_UNAVAILABLE'
  | 'CONVERSION_TIMEOUT'
  | 'INVALID_RESPONSE'
  | 'NETWORK_ERROR'
  | 'INTERNAL_ERROR';

interface PreviewErrorPayload {
  error?: {
    code?: string;
    message?: string;
  };
}

export class OfficePreviewRequestError extends Error {
  readonly code: OfficePreviewErrorCode;
  readonly status: number;

  constructor(code: OfficePreviewErrorCode, message: string, status = 0) {
    super(message);
    this.name = 'OfficePreviewRequestError';
    this.code = code;
    this.status = status;
  }
}

function isKnownCode(value: string | undefined): value is OfficePreviewErrorCode {
  return value === 'MISSING_EXTENSION'
    || value === 'UNSUPPORTED_EXTENSION'
    || value === 'FILE_TOO_LARGE'
    || value === 'PASSWORD_PROTECTED'
    || value === 'INVALID_FILE'
    || value === 'CONVERSION_FAILED'
    || value === 'PREVIEW_BUSY'
    || value === 'SERVICE_UNAVAILABLE'
    || value === 'CONVERSION_TIMEOUT'
    || value === 'INTERNAL_ERROR';
}

async function parseFailure(response: Response): Promise<OfficePreviewRequestError> {
  let payload: PreviewErrorPayload | null = null;
  try {
    payload = await response.json() as PreviewErrorPayload;
  } catch {
    // A gateway or reverse proxy can replace the JSON body. Keep a stable
    // client-facing error instead of exposing the returned HTML.
  }
  const serverCode = payload?.error?.code;
  const code = isKnownCode(serverCode) ? serverCode : 'INTERNAL_ERROR';
  const message = payload?.error?.message || `Office preview failed (${response.status})`;
  return new OfficePreviewRequestError(code, message, response.status);
}

function beginsWithPdfSignature(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 5
    && bytes[0] === 0x25
    && bytes[1] === 0x50
    && bytes[2] === 0x44
    && bytes[3] === 0x46
    && bytes[4] === 0x2d;
}

/**
 * Convert one local Office file to PDF through the same-origin preview service.
 * The returned bytes stay in memory and are passed directly to PDF.js; no
 * persistent or long-lived blob URL is created.
 */
export async function requestOfficePdf(
  source: Blob,
  format: FileFormatDescriptor,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (!format.supported || !['doc', 'docx', 'ppt', 'pptx'].includes(format.extension)) {
    throw new OfficePreviewRequestError(
      'UNSUPPORTED_EXTENSION',
      'This Office file type is not supported by the paged preview client.',
      415,
    );
  }
  if (source.size > OFFICE_PREVIEW_MAX_BYTES) {
    throw new OfficePreviewRequestError(
      'FILE_TOO_LARGE',
      'The file exceeds the 25 MiB preview limit.',
      413,
    );
  }
  if (isPasswordProtectedOfficeFile(new Uint8Array(await source.arrayBuffer()))) {
    throw new OfficePreviewRequestError(
      'PASSWORD_PROTECTED',
      'The document is password protected.',
      423,
    );
  }

  let response: Response;
  try {
    response = await netFetch(OFFICE_PREVIEW_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-File-Extension': format.extension,
      },
      body: source,
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new OfficePreviewRequestError(
      'NETWORK_ERROR',
      error instanceof Error ? error.message : 'Unable to reach the Office preview service.',
    );
  }

  if (!response.ok) throw await parseFailure(response);

  const contentType = response.headers.get('content-type')?.toLowerCase() || '';
  if (!contentType.startsWith('application/pdf')) {
    throw new OfficePreviewRequestError(
      'INVALID_RESPONSE',
      'The Office preview service returned an unexpected content type.',
      response.status,
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!beginsWithPdfSignature(bytes)) {
    throw new OfficePreviewRequestError(
      'INVALID_RESPONSE',
      'The Office preview service returned an invalid PDF.',
      response.status,
    );
  }
  return bytes;
}

export function getOfficePreviewErrorKey(error: unknown): string {
  if (!(error instanceof OfficePreviewRequestError)) return 'viewer_error_generic';
  if (error.code === 'FILE_TOO_LARGE') return 'viewer_error_too_large';
  if (error.code === 'PASSWORD_PROTECTED') return 'viewer_error_password';
  if (error.code === 'INVALID_FILE' || error.code === 'CONVERSION_FAILED') {
    return 'viewer_error_damaged';
  }
  if (error.code === 'PREVIEW_BUSY') return 'viewer_error_busy';
  if (error.code === 'CONVERSION_TIMEOUT') return 'viewer_error_timeout';
  if (error.code === 'SERVICE_UNAVAILABLE' || error.code === 'NETWORK_ERROR') {
    return 'viewer_error_service_unavailable';
  }
  return 'viewer_error_generic';
}

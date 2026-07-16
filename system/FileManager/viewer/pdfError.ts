export type PdfLoadErrorKind = 'password-protected' | 'corrupted';

/** PDF.js exposes password failures by stable error name across builds. */
export function classifyPdfLoadError(error: unknown): PdfLoadErrorKind {
  if (error && typeof error === 'object') {
    const candidate = error as { name?: unknown; code?: unknown };
    if (candidate.name === 'PasswordException' || candidate.code === 'PASSWORD') {
      return 'password-protected';
    }
  }
  return 'corrupted';
}


import * as FileShareService from '../../os/FileShareService';

/** Start the system image share flow and report whether it was accepted. */
export function shareImagesAsIntent(paths: readonly string[]): boolean {
  if (paths.length === 0 || typeof window === 'undefined') return false;
  const os = window.__OS__;
  if (!os?.startActivity) return false;

  try {
    const payload = FileShareService.createPayload(paths);
    return os.startActivity(
      FileShareService.createSendIntent(payload),
      { newTask: true },
    ) === true;
  } catch (error) {
    console.error('[Gallery] Unable to share selected images:', error);
    return false;
  }
}


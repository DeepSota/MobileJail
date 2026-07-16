import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strings } from '@/system/Gallery/res/strings';
import { stringsEn } from '@/system/Gallery/res/strings.en';

const fileShareMock = vi.hoisted(() => ({
  createPayload: vi.fn(),
  createSendIntent: vi.fn(),
}));

vi.mock('@/os/FileShareService', () => fileShareMock);

import { shareImagesAsIntent } from '@/system/Gallery/shareImages';

describe('Gallery image sharing', () => {
  const startActivity = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    fileShareMock.createPayload.mockReturnValue({ version: 1, files: [], mimeType: 'image/*' });
    fileShareMock.createSendIntent.mockReturnValue({ action: 'ACTION_SEND', type: 'image/*' });
    vi.stubGlobal('window', { __OS__: { startActivity } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns true only when the OS accepts the share flow', () => {
    startActivity.mockReturnValue(true);

    expect(shareImagesAsIntent(['/sdcard/DCIM/photo.jpg'])).toBe(true);
    expect(fileShareMock.createPayload).toHaveBeenCalledWith(['/sdcard/DCIM/photo.jpg']);
    expect(startActivity).toHaveBeenCalledWith(
      { action: 'ACTION_SEND', type: 'image/*' },
      { newTask: true },
    );

    startActivity.mockReturnValue(false);
    expect(shareImagesAsIntent(['/sdcard/DCIM/photo.jpg'])).toBe(false);
  });

  it('returns false without trying to launch for an empty selection or unavailable OS', () => {
    expect(shareImagesAsIntent([])).toBe(false);
    expect(startActivity).not.toHaveBeenCalled();

    vi.stubGlobal('window', {});
    expect(shareImagesAsIntent(['/sdcard/DCIM/photo.jpg'])).toBe(false);
  });

  it('returns false when the source image can no longer be shared', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fileShareMock.createPayload.mockImplementation(() => {
      throw new Error('missing source');
    });

    expect(shareImagesAsIntent(['/sdcard/DCIM/missing.jpg'])).toBe(false);
    expect(startActivity).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  it('shows the localized failure Toast at every Gallery share entry point', () => {
    const source = readFileSync('system/Gallery/GalleryApp.tsx', 'utf8');
    expect(source.match(/showToast\(s\.share_failed\)/g)).toHaveLength(3);
    expect(strings.share_failed).toBeTruthy();
    expect(stringsEn.share_failed).toBeTruthy();
  });
});

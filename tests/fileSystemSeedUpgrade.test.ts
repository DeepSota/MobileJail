import { describe, expect, it } from 'vitest';

import { _seedUpgradeTestOnly } from '@/os/FileSystemService';

describe('FileSystem seed upgrade preservation policy', () => {
  const incomingId = 'seed__sdcard_Documents_new-report.pdf';

  it('preserves a user-created file or directory at a new seed path', () => {
    expect(_seedUpgradeTestOnly.shouldPreserveSeedPathOccupant(
      'file_user_document',
      incomingId,
    )).toBe(true);
    expect(_seedUpgradeTestOnly.shouldPreserveSeedPathOccupant(
      'dir_user_folder',
      incomingId,
    )).toBe(true);
  });

  it('preserves an older seed file moved onto a new seed path', () => {
    expect(_seedUpgradeTestOnly.shouldPreserveSeedPathOccupant(
      'seed__sdcard_Documents_old-report.pdf',
      incomingId,
    )).toBe(true);
  });

  it('refreshes only the matching seed entry at its original path', () => {
    expect(_seedUpgradeTestOnly.shouldPreserveSeedPathOccupant(
      incomingId,
      incomingId,
    )).toBe(false);
    expect(_seedUpgradeTestOnly.shouldPreserveSeedPathOccupant(
      undefined,
      incomingId,
    )).toBe(false);
  });
});

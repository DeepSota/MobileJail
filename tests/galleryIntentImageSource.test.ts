import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FSNode } from '@/os/types';

const shareMock = vi.hoisted(() => ({
  resolveViewIntent: vi.fn(),
}));

vi.mock('@/os/FileShareService', () => shareMock);

import {
  isPrivateAttachmentPath,
  resolveIntentImageSource,
} from '@/system/Gallery/intentImageSource';

function imageNode(path: string): FSNode {
  return {
    id: 'image-1',
    name: path.split('/').pop() || 'image.png',
    type: 'file',
    parentId: 'parent',
    path,
    size: 12,
    mimeType: 'image/png',
    createdAt: 1,
    modifiedAt: 2,
    storage: 'indexeddb',
  };
}

describe('Gallery ACTION_VIEW image source', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves a content URI to its current private path and marks it read-only', () => {
    const node = imageNode('/data/data/wechat/attachments/att_1/photo.png');
    shareMock.resolveViewIntent.mockReturnValue({
      node,
      ref: {
        version: 1,
        fileId: node.id,
        uri: 'content://simfs/files/image-1',
        name: node.name,
        mimeType: node.mimeType,
        size: node.size,
        modifiedAt: node.modifiedAt,
      },
    });

    const intent = {
      action: 'ACTION_VIEW',
      type: 'image/png',
      data: { stream: 'content://simfs/files/image-1' },
    } as const;
    const source = resolveIntentImageSource(intent);

    expect(shareMock.resolveViewIntent).toHaveBeenCalledWith(intent, 'gallery');
    expect(source).toEqual({ path: node.path, readOnly: true });
  });

  it('accepts legacy image paths without treating normal shared storage as private', () => {
    const node = imageNode('/sdcard/Pictures/trip.jpg');
    shareMock.resolveViewIntent.mockReturnValue({ node, ref: {} });

    expect(resolveIntentImageSource({
      action: 'ACTION_VIEW',
      type: 'image/jpeg',
      data: { path: '/sdcard/Pictures/trip.jpg' },
    })).toEqual({ path: '/sdcard/Pictures/trip.jpg', readOnly: false });
  });

  it('rejects a raw private path when no canonical grant resolves', () => {
    shareMock.resolveViewIntent.mockReturnValue(null);
    expect(resolveIntentImageSource({
      action: 'ACTION_VIEW',
      type: 'image/png',
      data: { path: '/data/data/wechat/attachments/att_1/private.png' },
    })).toBeNull();
  });

  it('rejects non-image and non-view intents', () => {
    expect(resolveIntentImageSource({
      action: 'ACTION_VIEW',
      type: 'application/pdf',
      data: { path: '/sdcard/Documents/report.pdf' },
    })).toBeNull();
    expect(resolveIntentImageSource({
      action: 'ACTION_SEND',
      type: 'image/png',
      data: { path: '/sdcard/Pictures/photo.png' },
    })).toBeNull();
  });

  it('only classifies the real App-private root as private', () => {
    expect(isPrivateAttachmentPath('/data/data/mail/attachments/a/photo.png')).toBe(true);
    expect(isPrivateAttachmentPath('/data/database/photo.png')).toBe(false);
    expect(isPrivateAttachmentPath('/sdcard/data/data/photo.png')).toBe(false);
  });
});

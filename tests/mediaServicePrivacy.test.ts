import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FSNode } from '@/os/types';

const fsMock = vi.hoisted(() => ({
  getMediaFiles: vi.fn(),
  getFilesByPath: vi.fn(),
  getFileUri: vi.fn(),
  getNode: vi.fn(),
  writeFile: vi.fn(),
  deleteNode: vi.fn(),
}));

vi.mock('@/os/FileSystemService', () => fsMock);

import { getAlbums, getMediaItem, getMediaItems } from '@/os/MediaService';

function image(id: string, path: string): FSNode {
  return {
    id,
    name: `${id}.png`,
    type: 'file',
    parentId: 'parent',
    path,
    size: 10,
    mimeType: 'image/png',
    createdAt: 1,
    modifiedAt: 1,
    storage: 'indexeddb',
  };
}

describe('MediaService App-private attachment isolation', () => {
  const publicImage = image('public', '/sdcard/Pictures/public.png');
  const privateImage = image('private', '/data/data/wechat/attachments/att_1/private.png');

  beforeEach(() => {
    vi.clearAllMocks();
    fsMock.getMediaFiles.mockReturnValue([publicImage, privateImage]);
    fsMock.getFilesByPath.mockReturnValue([publicImage, privateImage]);
    fsMock.getFileUri.mockImplementation((path: string) => path);
    fsMock.getNode.mockImplementation((path: string) => (
      path === privateImage.path ? privateImage : publicImage
    ));
  });

  it('omits private images from Gallery lists, albums, and media pickers', () => {
    expect(getMediaItems({ type: 'image' }).map((item) => item.id)).toEqual(['public']);
    expect(getAlbums().find((album) => album.id === 'all')?.count).toBe(1);
  });

  it('does not expose a private attachment through direct media lookup', () => {
    expect(getMediaItem(privateImage.path)).toBeNull();
    expect(getMediaItem(publicImage.path)?.id).toBe('public');
  });
});

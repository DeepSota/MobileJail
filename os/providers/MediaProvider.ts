import type { MediaItem, UserAlbumDef } from '../types';
import ContentProvider from '../ContentProvider';
import ContentResolver from '../ContentResolver';
import { createOsStore } from '../createOsStore';
import type { ContentUri, ContentValues, Cursor } from '../types/content';
import * as MediaService from '../MediaService';
import * as FileSystem from '../FileSystemService';
import BroadcastBus, { ACTION_MEDIA_SCANNER_SCAN_FILE } from '../BroadcastBus';
import { now as timeNow } from '../TimeService';
import mediaDefaults from './defaults/media.json';
import { ALBUM_DEFINITIONS } from '../data/fileSystemConfig';

export interface MediaProviderState {
  favorites: string[];
  userAlbums: UserAlbumDef[];
  pinnedAlbumIds: string[];
  albumNameOverrides: Record<string, string>;
}

const runtimeImages: MediaItem[] = [];

function mergeById(primary: MediaItem[], secondary: MediaItem[]): MediaItem[] {
  const out: MediaItem[] = [];
  const seen = new Set<string>();
  for (const item of [...primary, ...secondary]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function withFavorite(items: MediaItem[], favorites: Set<string>): Array<MediaItem & { favorite: boolean }> {
  return items.map((item) => ({
    ...item,
    favorite: favorites.has(item.path),
  }));
}

function genMediaId(): string {
  return `media_${timeNow()}_${Math.random().toString(36).slice(2, 8)}`;
}

const defaultState: MediaProviderState = {
  favorites: structuredClone((mediaDefaults as { favorites?: string[] }).favorites ?? []) as string[],
  userAlbums: [],
  pinnedAlbumIds: [],
  albumNameOverrides: {},
};

export const useMediaProviderStore = createOsStore<MediaProviderState>(
  'provider.media',
  defaultState,
  {
    persistName: 'provider_media',
    registerToServiceRegistry: false,
    registerToProviderRegistry: true,
  },
);

export class MediaProvider extends ContentProvider {
  query(uri: ContentUri, _projection?: string[]): Cursor<any> {
    const parsed = ContentResolver.parseUri(uri);
    const path = parsed.path;
    const favorites = new Set(useMediaProviderStore.getState().favorites || []);

    if (path === '/images' || path === '/images/') {
      const images = mergeById(runtimeImages, MediaService.getMediaItems({ type: 'image' }));
      const items = withFavorite(images, favorites);
      return { items, count: items.length };
    }

    if (path === '/videos' || path === '/videos/') {
      const videos = MediaService.getMediaItems({ type: 'video' });
      return { items: videos, count: videos.length };
    }

    if (path === '/images/albums') {
      const albums = MediaService.getAlbums();
      return { items: albums, count: albums.length };
    }

    if (path === '/favorites' || path === '/favorites/') {
      const items = Array.from(favorites).map((favoritePath) => ({ path: favoritePath }));
      return { items, count: items.length };
    }

    const imageMatch = path.match(/^\/images\/([^/]+)$/);
    if (imageMatch) {
      const id = imageMatch[1];
      const images = mergeById(runtimeImages, MediaService.getMediaItems({ type: 'image' }));
      const item = images.find((x) => x.id === id);
      if (!item) return { items: [], count: 0 };
      return { items: [{ ...item, favorite: favorites.has(item.path) }], count: 1 };
    }

    const videoMatch = path.match(/^\/videos\/([^/]+)$/);
    if (videoMatch) {
      const id = videoMatch[1];
      const item = MediaService.getMediaItems({ type: 'video' }).find((x) => x.id === id);
      if (!item) return { items: [], count: 0 };
      return { items: [item], count: 1 };
    }

    return { items: [], count: 0 };
  }

  insert(uri: ContentUri, values: ContentValues): ContentUri {
    const parsed = ContentResolver.parseUri(uri);

    // Create user album: insert into /images/albums
    if (parsed.path === '/images/albums') {
      const name = typeof values.name === 'string' ? values.name : '';
      if (!name.trim()) throw new Error('[MediaProvider] Album name cannot be empty');
      const def = _createUserAlbum(name.trim());
      return `content://media/images/albums/${def.id}`;
    }

    if (!(parsed.path === '/images' || parsed.path === '/images/')) {
      throw new Error(`[MediaProvider] Unsupported insert URI: ${parsed.path}`);
    }

    const now = timeNow();
    const id = typeof values.id === 'string' ? values.id : genMediaId();
    const mimeType = typeof values.mimeType === 'string' ? values.mimeType : 'image/jpeg';
    const ext = mimeType.includes('png') ? 'png' : mimeType.includes('gif') ? 'gif' : 'jpg';
    const fileName = typeof values.fileName === 'string' ? values.fileName : `IMG_${now}.${ext}`;
    const path = typeof values.path === 'string' ? values.path : `/sdcard/DCIM/Camera/${fileName}`;
    const uriValue = typeof values.uri === 'string'
      ? values.uri
      : `data:${mimeType};base64,`;

    const item: MediaItem = {
      id,
      type: 'image',
      uri: uriValue,
      thumbnailUri: typeof values.thumbnailUri === 'string' ? values.thumbnailUri : undefined,
      name: fileName,
      mimeType,
      size: typeof values.size === 'number' ? values.size : 0,
      width: typeof values.width === 'number' ? values.width : undefined,
      height: typeof values.height === 'number' ? values.height : undefined,
      duration: undefined,
      createdAt: now,
      path,
    };

    runtimeImages.unshift(item);
    BroadcastBus.sendBroadcast({
      action: ACTION_MEDIA_SCANNER_SCAN_FILE,
      extras: { id: item.id, uri: item.uri, path: item.path },
    });
    return `content://media/images/${item.id}`;
  }

  update(uri: ContentUri, values: ContentValues, _where?: string): number {
    const parsed = ContentResolver.parseUri(uri);

    // Rename user album: update /images/albums/{id}
    const albumMatch = parsed.path.match(/^\/images\/albums\/([^/]+)$/);
    if (albumMatch) {
      const albumId = albumMatch[1];
      if ('name' in values && typeof values.name === 'string') {
        _renameUserAlbum(albumId, values.name);
        return 1;
      }
      return 0;
    }

    // Move photo to album: update /images/{id}/moveToAlbum
    const moveMatch = parsed.path.match(/^\/images\/([^/]+)\/moveToAlbum$/);
    if (moveMatch) {
      const photoId = moveMatch[1];
      const targetAlbumId = typeof values.albumId === 'string' ? values.albumId : '';
      _moveToAlbum(photoId, targetAlbumId);
      return 1;
    }

    const imageMatch = parsed.path.match(/^\/images\/([^/]+)$/);
    const videoMatch = parsed.path.match(/^\/videos\/([^/]+)$/);
    const id = imageMatch?.[1] ?? videoMatch?.[1];
    if (!id) return 0;
    const images = mergeById(runtimeImages, MediaService.getMediaItems({ type: 'image' }));
    const videos = MediaService.getMediaItems({ type: 'video' });
    const item = [...images, ...videos].find((entry) => entry.id === id);
    if (!item) return 0;
    if ('favorite' in values) {
      const shouldFavorite = Boolean(values.favorite);
      const currentFavorites = useMediaProviderStore.getState().favorites;
      const next = new Set(currentFavorites);
      if (shouldFavorite) {
        next.add(item.path);
      } else {
        next.delete(item.path);
      }
      useMediaProviderStore.setState({ favorites: Array.from(next) });
      return 1;
    }
    return 0;
  }

  delete(uri: ContentUri, _where?: string): number {
    const parsed = ContentResolver.parseUri(uri);

    // Delete user album: delete /images/albums/{id}
    const albumMatch = parsed.path.match(/^\/images\/albums\/([^/]+)$/);
    if (albumMatch) {
      _deleteUserAlbum(albumMatch[1]);
      return 1;
    }

    const imageMatch = parsed.path.match(/^\/images\/([^/]+)$/);
    if (!imageMatch) return 0;
    const id = imageMatch[1];
    const before = runtimeImages.length;
    const item = runtimeImages.find((entry) => entry.id === id);
    const next = runtimeImages.filter((x) => x.id !== id);
    runtimeImages.length = 0;
    runtimeImages.push(...next);
    if (item) {
      const currentFavorites = useMediaProviderStore.getState().favorites;
      useMediaProviderStore.setState({
        favorites: currentFavorites.filter((favoritePath) => favoritePath !== item.path),
      });
    }
    return before === next.length ? 0 : 1;
  }

  getType(uri: ContentUri): string {
    const parsed = ContentResolver.parseUri(uri);
    if (parsed.path.startsWith('/videos')) return 'video/*';
    return 'image/*';
  }
}

let mediaProvider: MediaProvider | null = null;

export function ensureMediaProviderRegistered(): void {
  if (!mediaProvider) {
    mediaProvider = new MediaProvider();
  }
  ContentResolver.registerProvider('media', mediaProvider);
}

// ---------------------------------------------------------------------------
// User Album convenience API
// ---------------------------------------------------------------------------

const USER_ALBUM_BASE = '/sdcard/Pictures';

function _createUserAlbum(name: string): UserAlbumDef {
  const id = `user_${timeNow()}_${Math.random().toString(36).slice(2, 8)}`;
  const pathPattern = `${USER_ALBUM_BASE}/${name}`;
  const def: UserAlbumDef = { id, name, pathPattern, createdAt: timeNow() };

  // Create the directory in the virtual filesystem
  FileSystem.createDirectory(pathPattern);

  useMediaProviderStore.setState({
    userAlbums: [...useMediaProviderStore.getState().userAlbums, def],
  });

  BroadcastBus.sendBroadcast({ action: ACTION_MEDIA_SCANNER_SCAN_FILE });
  return def;
}

async function _renameUserAlbum(albumId: string, newName: string): Promise<void> {
  const store = useMediaProviderStore.getState();
  const album = store.userAlbums.find(a => a.id === albumId);
  if (!album) throw new Error(`[MediaProvider] User album not found: ${albumId}`);

  const oldPath = album.pathPattern;
  const newPath = `${USER_ALBUM_BASE}/${newName}`;

  // Rename the directory in filesystem
  await FileSystem.moveNode(oldPath, newPath);

  useMediaProviderStore.setState({
    userAlbums: store.userAlbums.map(a =>
      a.id === albumId ? { ...a, name: newName, pathPattern: newPath } : a,
    ),
  });

  BroadcastBus.sendBroadcast({ action: ACTION_MEDIA_SCANNER_SCAN_FILE });
}

async function _deleteUserAlbum(albumId: string): Promise<void> {
  const store = useMediaProviderStore.getState();
  const album = store.userAlbums.find(a => a.id === albumId);
  if (!album) {
    console.warn('[MediaProvider] _deleteUserAlbum: album not found in store:', albumId);
    return;
  }

  // Delete the directory and all its contents
  try {
    await FileSystem.deleteNode(album.pathPattern);
  } catch (e) {
    console.error('[MediaProvider] _deleteUserAlbum: FileSystem.deleteNode failed:', e);
  }

  useMediaProviderStore.setState({
    userAlbums: store.userAlbums.filter(a => a.id !== albumId),
  });

  BroadcastBus.sendBroadcast({ action: ACTION_MEDIA_SCANNER_SCAN_FILE });
}

async function _moveToAlbum(photoId: string, targetAlbumId: string): Promise<void> {
  // Resolve target album path
  const store = useMediaProviderStore.getState();
  const userAlbum = store.userAlbums.find(a => a.id === targetAlbumId);

  let targetDir: string;
  if (userAlbum) {
    targetDir = userAlbum.pathPattern;
  } else {
    // Check static albums
    const staticAlbum = (ALBUM_DEFINITIONS as Array<{ id: string; pathPattern: string | null }>)
      .find(a => a.id === targetAlbumId && a.pathPattern);
    if (!staticAlbum?.pathPattern) throw new Error(`[MediaProvider] Album not found: ${targetAlbumId}`);
    targetDir = staticAlbum.pathPattern;
  }

  // Find the photo
  const allMedia = [
    ...mergeById(runtimeImages, MediaService.getMediaItems({ type: 'image' })),
    ...MediaService.getMediaItems({ type: 'video' }),
  ];
  const photo = allMedia.find(x => x.id === photoId);
  if (!photo) throw new Error(`[MediaProvider] Photo not found: ${photoId}`);

  const destPath = `${targetDir}/${photo.name}`;
  await FileSystem.moveNode(photo.path, destPath);

  BroadcastBus.sendBroadcast({ action: ACTION_MEDIA_SCANNER_SCAN_FILE });
}

/** Public convenience API for Gallery and other apps */
export function createAlbum(name: string): Promise<UserAlbumDef> {
  return Promise.resolve(_createUserAlbum(name));
}

export async function renameAlbum(id: string, newName: string): Promise<void> {
  // Try user album first
  const store = useMediaProviderStore.getState();
  const userAlbum = store.userAlbums.find(a => a.id === id);
  if (userAlbum) {
    await _renameUserAlbum(id, newName);
  } else {
    // System / app album: store name override
    useMediaProviderStore.setState({
      albumNameOverrides: { ...store.albumNameOverrides, [id]: newName },
    });
    BroadcastBus.sendBroadcast({ action: ACTION_MEDIA_SCANNER_SCAN_FILE });
  }
  return Promise.resolve();
}

export function getAlbumNameOverrides(): Record<string, string> {
  return useMediaProviderStore.getState().albumNameOverrides;
}

export async function deleteAlbum(id: string): Promise<void> {
  await _deleteUserAlbum(id);
}

export function moveToAlbum(photoPath: string, albumId: string): Promise<void> {
  // Find media item by path (images + videos)
  const allMedia = [
    ...mergeById(runtimeImages, MediaService.getMediaItems({ type: 'image' })),
    ...MediaService.getMediaItems({ type: 'video' }),
  ];
  const photo = allMedia.find(x => x.path === photoPath);
  if (!photo) return Promise.reject(new Error(`Photo not found: ${photoPath}`));
  return _moveToAlbum(photo.id, albumId);
}

export function getUserAlbums(): UserAlbumDef[] {
  return useMediaProviderStore.getState().userAlbums;
}

export function getPinnedAlbumIds(): string[] {
  return useMediaProviderStore.getState().pinnedAlbumIds;
}

export function togglePinAlbum(albumId: string): void {
  const store = useMediaProviderStore.getState();
  const isPinned = store.pinnedAlbumIds.includes(albumId);
  useMediaProviderStore.setState({
    pinnedAlbumIds: isPinned
      ? store.pinnedAlbumIds.filter(id => id !== albumId)
      : [...store.pinnedAlbumIds, albumId],
  });
  BroadcastBus.sendBroadcast({ action: ACTION_MEDIA_SCANNER_SCAN_FILE });
}

export default MediaProvider;

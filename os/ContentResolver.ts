import ContentProvider from './ContentProvider';
import type { ContentUri, ContentValues, Cursor } from './types/content';
import BroadcastBus, { ACTION_PROVIDER_CHANGED } from './BroadcastBus';
import PackageManagerService from './PackageManagerService';
import { PermissionService } from './PermissionService';
import { isPermissionId, PERMISSIONS } from './permissions';

type ContentObserver = (uri: ContentUri) => void;

type ParsedContentUri = {
  uri: ContentUri;
  authority: string;
  path: string;
  query: URLSearchParams;
};

const providers = new Map<string, ContentProvider>();

const SYSTEM_PROVIDER_PERMISSIONS: Record<string, { read?: string; write?: string }> = {
  contacts: {
    read: PERMISSIONS.READ_CONTACTS,
    write: PERMISSIONS.WRITE_CONTACTS,
  },
  media: {
    read: PERMISSIONS.READ_EXTERNAL_STORAGE,
    write: PERMISSIONS.WRITE_EXTERNAL_STORAGE,
  },
  sms: {
    read: PERMISSIONS.RECEIVE_SMS,
    write: PERMISSIONS.SEND_SMS,
  },
};

export type ContentPermissionDenialReason =
  | 'manifest_missing'
  | 'permission_not_declared'
  | 'runtime_denied'
  | 'runtime_denied_forever';

/** Stable Android-like security error for protected ContentProvider access. */
export class PermissionDeniedError extends Error {
  readonly code = 'PERMISSION_DENIED';

  constructor(
    readonly appId: string,
    readonly permission: string,
    readonly operation: string,
    readonly uri: ContentUri,
    readonly reason: ContentPermissionDenialReason,
  ) {
    super(`Permission denied: ${appId} cannot ${operation} ${uri}; requires ${permission} (${reason})`);
    this.name = 'PermissionDeniedError';
  }
}

function parseUri(uri: ContentUri): ParsedContentUri {
  const raw = String(uri ?? '').trim();
  if (!raw) throw new Error('[ContentResolver] URI is required');
  if (!raw.startsWith('content:')) {
    const scheme = raw.match(/^([^:]+):/)?.[1] ?? '';
    throw new Error(`[ContentResolver] Unsupported scheme: ${scheme ? `${scheme}:` : '(none)'}; uri=${JSON.stringify(raw)}`);
  }

  const match = raw.match(/^content:\/\/([^/?#]+)([^?#]*)?(?:\?([^#]*))?(?:#.*)?$/);
  const authority = String(match?.[1] ?? '').trim();
  if (!authority) throw new Error(`[ContentResolver] Missing authority; uri=${JSON.stringify(raw)}`);
  const path = match?.[2] || '/';
  return { uri: raw, authority, path, query: new URLSearchParams(match?.[3] ?? '') };
}

function getProviderOrThrow(uri: ContentUri): { provider: ContentProvider; parsed: ParsedContentUri } {
  const parsed = parseUri(uri);
  const provider = providers.get(parsed.authority);
  if (!provider) {
    throw new Error(`[ContentResolver] No provider registered for authority="${parsed.authority}"`);
  }
  return { provider, parsed };
}

function getActiveCallerAppId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const os = window.__OS__;
    const state = typeof os?.getState === 'function' ? os.getState() : os?.state;
    const appId = String(state?.activeAppId ?? '').trim();
    return appId || null;
  } catch {
    return null;
  }
}

function enforcePermissionIfNeeded(required: string | undefined, op: string, uri: ContentUri): void {
  if (!required) return;
  const appId = getActiveCallerAppId();
  // No foreground caller means an OS-internal operation. Settings is also a
  // trusted system surface so it can inspect and maintain protected providers.
  if (!appId || appId === 'settings') return;

  const manifest = PackageManagerService.getPackageInfo(appId);
  if (!manifest) {
    throw new PermissionDeniedError(appId, required, op, uri, 'manifest_missing');
  }
  if (!(manifest.permissions as readonly string[] | undefined)?.includes(required)) {
    throw new PermissionDeniedError(appId, required, op, uri, 'permission_not_declared');
  }

  if (!isPermissionId(required)) return;
  const status = PermissionService.checkPermission(appId, required);
  if (status === 'denied_forever') {
    throw new PermissionDeniedError(appId, required, op, uri, 'runtime_denied_forever');
  }
  if (status === 'denied') {
    throw new PermissionDeniedError(appId, required, op, uri, 'runtime_denied');
  }
}

export const ContentResolver = {
  parseUri,

  registerProvider(authority: string, provider: ContentProvider): void {
    const key = String(authority ?? '').trim();
    if (!key) throw new Error('[ContentResolver] authority is required');
    if (!provider) throw new Error('[ContentResolver] provider is required');
    const systemPermissions = SYSTEM_PROVIDER_PERMISSIONS[key];
    provider.readPermission ??= systemPermissions?.read;
    provider.writePermission ??= systemPermissions?.write;
    providers.set(key, provider);
  },

  query<T = any>(uri: ContentUri, projection?: string[]): Cursor<T> {
    const { provider } = getProviderOrThrow(uri);
    enforcePermissionIfNeeded(provider.readPermission, 'query', uri);
    return provider.query(uri, projection) as Cursor<T>;
  },

  insert(uri: ContentUri, values: ContentValues): ContentUri {
    const { provider } = getProviderOrThrow(uri);
    enforcePermissionIfNeeded(provider.writePermission, 'insert', uri);
    const result = provider.insert(uri, values);
    ContentResolver.notifyChange(result || uri);
    return result;
  },

  update(uri: ContentUri, values: ContentValues, where?: string): number {
    const { provider } = getProviderOrThrow(uri);
    enforcePermissionIfNeeded(provider.writePermission, 'update', uri);
    const changed = provider.update(uri, values, where);
    if (changed > 0) ContentResolver.notifyChange(uri);
    return changed;
  },

  delete(uri: ContentUri, where?: string): number {
    const { provider } = getProviderOrThrow(uri);
    enforcePermissionIfNeeded(provider.writePermission, 'delete', uri);
    const changed = provider.delete(uri, where);
    if (changed > 0) ContentResolver.notifyChange(uri);
    return changed;
  },

  notifyChange(uri: ContentUri): void {
    const parsed = parseUri(uri);
    BroadcastBus.sendBroadcast({
      action: ACTION_PROVIDER_CHANGED,
      data: { uri: parsed.uri },
      extras: { uri: parsed.uri },
    });
  },

  registerContentObserver(uri: ContentUri, cb: ContentObserver): () => void {
    const target = parseUri(uri);
    return BroadcastBus.registerReceiver(ACTION_PROVIDER_CHANGED, (intent) => {
      const changedUri = String(intent?.extras?.uri ?? intent?.data?.uri ?? '').trim();
      if (!changedUri) return;
      let parsed: ParsedContentUri;
      try {
        parsed = parseUri(changedUri);
      } catch {
        return;
      }
      if (parsed.authority !== target.authority) return;
      if (!parsed.path.startsWith(target.path)) return;
      cb(changedUri);
    });
  },
};

// App-owned provider modules (`apps/<app>/providers/*.ts`,
// `system/<app>/providers/*.ts`) are eagerly loaded from
// `os/providers/appProvidersBootstrap.ts`, NOT from here. The glob lives
// downstream so that ContentResolver is fully initialized by the time those
// modules run their top-level `ContentResolver.registerProvider(...)` calls
// (Vite hoists eager-glob imports above any `const ContentResolver = {...}`
// declaration, producing a TDZ if the glob fires before the const binds).

export default ContentResolver;

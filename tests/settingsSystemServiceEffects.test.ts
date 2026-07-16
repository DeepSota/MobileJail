import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ContentProvider from '@/os/ContentProvider';
import {
  ContentResolver,
  PermissionDeniedError,
} from '@/os/ContentResolver';
import {
  getCurrentPosition,
  initLocationService,
  LocationAccessError,
  reverseGeocode,
} from '@/os/LocationService';
import { netFetch, NetworkUnavailableError } from '@/os/NetworkService';
import { defaultOsState, OsStateStore } from '@/os/OsStateStore';
import PackageManagerService from '@/os/PackageManagerService';
import { PERMISSIONS } from '@/os/permissions';
import { ConnectivityManager } from '@/os/managers/ConnectivityManager';
import type { AppManifest } from '@/os/types/manifest';
import type { ContentUri, ContentValues, Cursor } from '@/os/types/content';

const DECLARED_APP_ID = '__system_effects_declared__';
const UNDECLARED_APP_ID = '__system_effects_undeclared__';
const UNKNOWN_APP_ID = '__system_effects_unknown__';
const CONTENT_AUTHORITY = '__system_effects_provider__';

const theme: AppManifest['theme'] = {
  colors: {
    primary: '#000000',
    background: '#ffffff',
    textPrimary: '#000000',
    textSecondary: '#666666',
    statusBarForeground: 'dark',
  },
};

const declaredManifest: AppManifest = {
  id: DECLARED_APP_ID,
  packageName: 'test.system.effects.declared',
  displayName: 'System Effects Declared',
  version: '1.0.0',
  versionCode: 1,
  type: 'system',
  icon: '',
  iconBackground: '#000000',
  theme,
  permissions: [PERMISSIONS.READ_CONTACTS, PERMISSIONS.WRITE_CONTACTS],
};

const undeclaredManifest: AppManifest = {
  ...declaredManifest,
  id: UNDECLARED_APP_ID,
  packageName: 'test.system.effects.undeclared',
  displayName: 'System Effects Undeclared',
  permissions: [],
};

class ProtectedTestProvider extends ContentProvider {
  readPermission = PERMISSIONS.READ_CONTACTS;
  writePermission = PERMISSIONS.WRITE_CONTACTS;

  query(): Cursor<{ id: string }> {
    return { items: [{ id: '1' }], count: 1 };
  }

  insert(uri: ContentUri, _values: ContentValues): ContentUri {
    return `${uri}/1`;
  }

  update(): number {
    return 1;
  }

  delete(): number {
    return 1;
  }

  getType(): string {
    return 'vnd.android.cursor.item/test';
  }
}

let activeAppId: string | null = null;

function replaceOsState(mutator?: (state: typeof defaultOsState) => void): void {
  const state = structuredClone(defaultOsState);
  mutator?.(state);
  OsStateStore.setState(state, true);
}

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

function getPositionError(): Promise<GeolocationPositionError> {
  return new Promise((resolve, reject) => {
    getCurrentPosition(
      () => reject(new Error('expected location access to fail')),
      resolve,
    );
  });
}

beforeEach(() => {
  activeAppId = null;
  replaceOsState();
  initLocationService({ mode: 'simulated', simulatedLocation: 'beijing' });
  PackageManagerService.install(declaredManifest);
  PackageManagerService.install(undeclaredManifest);
  ContentResolver.registerProvider(CONTENT_AUTHORITY, new ProtectedTestProvider());

  const localStorage = createMemoryStorage();
  vi.stubGlobal('localStorage', localStorage);
  vi.stubGlobal('window', {
    location: { origin: 'http://mobile.test' },
    localStorage,
    __OS__: {
      getState: () => ({ activeAppId }),
    },
  });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })));
});

afterEach(() => {
  PackageManagerService.uninstall(DECLARED_APP_ID);
  PackageManagerService.uninstall(UNDECLARED_APP_ID);
  replaceOsState();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('NetworkService connectivity side effects', () => {
  it('blocks external and network-backed API requests with a stable offline error', async () => {
    replaceOsState((state) => {
      state.settings.global.wifiEnabled = false;
      state.settings.global.mobileDataEnabled = false;
    });

    for (const url of ['https://example.com/data', '/api/gw/fetch', '/api/weather']) {
      const request = netFetch(url);
      await expect(request).rejects.toBeInstanceOf(NetworkUnavailableError);
      await expect(request).rejects.toMatchObject({
        name: 'NetworkUnavailableError',
        code: 'NETWORK_UNAVAILABLE',
        requestUrl: url,
      });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps local static files and offline-capable system APIs available', async () => {
    replaceOsState((state) => {
      state.settings.global.wifiEnabled = false;
      state.settings.global.mobileDataEnabled = false;
    });

    await netFetch('/assets/offline-icon.svg');
    await netFetch('/sdcard/Documents/report.pdf');
    await netFetch('/api/preview/office', { method: 'POST' });
    await netFetch('/api/sdcard');

    expect(fetch).toHaveBeenCalledTimes(4);
  });
});

describe('ConnectivityManager airplane-mode restoration', () => {
  it('restores the exact pre-flight radio toggles, signal levels and mobile data type', () => {
    replaceOsState((state) => {
      state.settings.global.wifiEnabled = true;
      state.settings.global.mobileDataEnabled = true;
      state.settings.global.bluetoothEnabled = false;
      state.hardware.wifi.level = 3;
      state.hardware.cellular.signalLevel = 2;
      state.hardware.cellular.mobileDataType = '5g';
      state.hardware.cellular.noSim = false;
    });

    ConnectivityManager.setAirplaneModeEnabled(true);
    let state = OsStateStore.getState();
    expect(state.settings.global).toMatchObject({
      airplaneModeEnabled: true,
      wifiEnabled: false,
      mobileDataEnabled: false,
      bluetoothEnabled: false,
    });
    expect(state.hardware.wifi.level).toBe(0);
    expect(state.hardware.cellular).toMatchObject({ signalLevel: 0, mobileDataType: 'none' });

    // A repeated enable must not overwrite the stored pre-flight snapshot.
    ConnectivityManager.setAirplaneModeEnabled(true);
    ConnectivityManager.setAirplaneModeEnabled(false);

    state = OsStateStore.getState();
    expect(state.settings.global).toMatchObject({
      airplaneModeEnabled: false,
      wifiEnabled: true,
      mobileDataEnabled: true,
      bluetoothEnabled: false,
    });
    expect(state.hardware.wifi.level).toBe(3);
    expect(state.hardware.cellular).toMatchObject({ signalLevel: 2, mobileDataType: '5g' });
    expect(Object.keys(state.preferences).some((key) => key.startsWith('__connectivity_airplane_restore_'))).toBe(false);
  });
});

describe('LocationService OS policy enforcement', () => {
  it('blocks position and reverse geocoding when the system location switch is off', async () => {
    replaceOsState((state) => {
      state.settings.global.locationEnabled = false;
    });

    await expect(getPositionError()).resolves.toMatchObject({
      code: 2,
      reason: 'system_disabled',
    });
    await expect(reverseGeocode(39.9042, 116.4074)).rejects.toMatchObject({
      name: 'LocationAccessError',
      reason: 'system_disabled',
    });
  });

  it.each([
    ['denied', 'permission_denied'],
    ['denied_forever', 'permission_denied_forever'],
  ] as const)('blocks an active App whose LOCATION permission is %s', async (status, reason) => {
    activeAppId = DECLARED_APP_ID;
    replaceOsState((state) => {
      state.permissions[DECLARED_APP_ID] = {
        [PERMISSIONS.ACCESS_FINE_LOCATION]: status,
      };
    });

    const error = await getPositionError();
    expect(error).toBeInstanceOf(LocationAccessError);
    expect(error).toMatchObject({ code: 1, reason });
    await expect(reverseGeocode(39.9042, 116.4074)).rejects.toMatchObject({ reason });
  });

  it('preserves legacy access for an active App with not_requested LOCATION permissions', async () => {
    activeAppId = DECLARED_APP_ID;

    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      getCurrentPosition(resolve, reject);
    });

    expect(position.coords).toMatchObject({ latitude: 39.9042, longitude: 116.4074 });
  });
});

describe('ContentResolver caller permission enforcement', () => {
  const uri = `content://${CONTENT_AUTHORITY}/items`;

  it('rejects missing manifests and missing manifest declarations', () => {
    activeAppId = UNKNOWN_APP_ID;
    expect(() => ContentResolver.query(uri)).toThrowError(PermissionDeniedError);
    expect(() => ContentResolver.query(uri)).toThrowError(expect.objectContaining({
      reason: 'manifest_missing',
    }));

    activeAppId = UNDECLARED_APP_ID;
    expect(() => ContentResolver.query(uri)).toThrowError(expect.objectContaining({
      reason: 'permission_not_declared',
    }));
  });

  it('allows not_requested for compatibility but rejects explicit runtime denial', () => {
    activeAppId = DECLARED_APP_ID;
    expect(ContentResolver.query(uri).count).toBe(1);
    expect(ContentResolver.insert(uri, { value: 'ok' })).toBe(`${uri}/1`);

    replaceOsState((state) => {
      state.permissions[DECLARED_APP_ID] = {
        [PERMISSIONS.READ_CONTACTS]: 'denied',
        [PERMISSIONS.WRITE_CONTACTS]: 'denied_forever',
      };
    });
    expect(() => ContentResolver.query(uri)).toThrowError(expect.objectContaining({
      reason: 'runtime_denied',
    }));
    expect(() => ContentResolver.insert(uri, { value: 'blocked' })).toThrowError(expect.objectContaining({
      reason: 'runtime_denied_forever',
    }));
  });

  it('treats Settings and calls without an active App as trusted system callers', () => {
    activeAppId = 'settings';
    expect(ContentResolver.query(uri).count).toBe(1);

    activeAppId = null;
    expect(ContentResolver.insert(uri, { value: 'system' })).toBe(`${uri}/1`);
  });
});

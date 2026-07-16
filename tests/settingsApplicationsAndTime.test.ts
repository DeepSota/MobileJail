import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FSNode } from '@/os/types';

const fsMock = vi.hoisted(() => ({
  getNode: vi.fn<(path: string) => FSNode | null>(),
  exists: vi.fn<(path: string) => boolean>(),
  searchFiles: vi.fn<(
    query: string,
    options?: { path?: string; mimeType?: string; type?: FSNode['type'] },
  ) => FSNode[]>(),
  listDirectory: vi.fn<(path: string) => FSNode[]>(),
  deleteNode: vi.fn<(path: string) => Promise<boolean>>(),
}));

vi.mock('@/os/FileSystemService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/os/FileSystemService')>()),
  ...fsMock,
}));

import { defaultOsState, OsStateStore } from '../os/OsStateStore';
import { routeGetPreference, routeSetPreference } from '../os/managers/registry';
import * as TimeService from '../os/TimeService';
import { NAVIGATION_DECLARATION } from '../system/Settings/navigation.declaration';

function node(path: string, type: FSNode['type'], size = 0): FSNode {
  const separator = path.lastIndexOf('/');
  const parentPath = separator > 0 ? path.slice(0, separator) : '/';
  return {
    id: path,
    name: path.slice(separator + 1),
    type,
    parentId: parentPath,
    path,
    size: type === 'file' ? size : 0,
    mimeType: type === 'file' ? 'application/octet-stream' : undefined,
    createdAt: 1,
    modifiedAt: 1,
    storage: 'indexeddb',
  };
}

function seedPrivateStorage(): Map<string, FSNode> {
  const nodes = [
    node('/data/data/wechat', 'directory'),
    node('/data/data/wechat/cache', 'directory'),
    node('/data/data/wechat/cache/thumb.bin', 'file', 10),
    node('/data/data/wechat/code_cache', 'directory'),
    node('/data/data/wechat/code_cache/runtime.bin', 'file', 20),
    node('/data/data/wechat/tmp', 'directory'),
    node('/data/data/wechat/tmp/upload.tmp', 'file', 30),
    node('/data/data/wechat/files', 'directory'),
    node('/data/data/wechat/files/cache', 'directory'),
    node('/data/data/wechat/files/cache/previews', 'directory'),
    node('/data/data/wechat/files/cache/previews/page.png', 'file', 40),
    node('/data/data/wechat/files/user.db', 'file', 50),
    // A prefix collision must never be counted or cleared as WeChat private data.
    node('/data/data/wechat_beta', 'directory'),
    node('/data/data/wechat_beta/cache', 'directory'),
    node('/data/data/wechat_beta/cache/not-yours.bin', 'file', 999),
  ];
  const graph = new Map(nodes.map((item) => [item.path, item]));

  fsMock.getNode.mockImplementation((path) => graph.get(path) ?? null);
  fsMock.exists.mockImplementation((path) => graph.has(path));
  fsMock.searchFiles.mockImplementation((query, options) => {
    const normalizedQuery = query.trim().toLowerCase();
    return [...graph.values()].filter((item) => {
      // Mirror the service's prefix-based path filter so the helper itself must
      // enforce the `/data/data/<app>/` boundary.
      if (options?.path && !item.path.startsWith(options.path)) return false;
      if (options?.type && item.type !== options.type) return false;
      if (options?.mimeType && item.mimeType !== options.mimeType) return false;
      return !normalizedQuery || item.name.toLowerCase().includes(normalizedQuery);
    });
  });
  fsMock.listDirectory.mockImplementation((path) => (
    [...graph.values()].filter((item) => item.parentId === path)
  ));
  fsMock.deleteNode.mockImplementation(async (path) => {
    const targets = [...graph.keys()].filter(
      (candidate) => candidate === path || candidate.startsWith(`${path}/`),
    );
    for (const target of targets) graph.delete(target);
    return targets.length > 0;
  });

  return graph;
}

describe('Settings application management and date/time state', () => {
  beforeEach(() => {
    OsStateStore.setState(structuredClone(defaultOsState), true);
    TimeService.useRealTime();
    vi.clearAllMocks();
  });

  afterEach(() => {
    TimeService.useRealTime();
  });

  it('starts with typed date, region, and default-open handler defaults', () => {
    const { system, secure } = OsStateStore.getState().settings;

    expect(system.automaticDateTime).toBe(true);
    expect(system.use24HourFormat).toBe(true);
    expect(system.timeZone).toBe('Asia/Shanghai');
    expect(system.region).toBe('CN');
    expect(system.manualTime).toBeNull();
    expect(secure.defaultOpenHandlers).toEqual({
      pdf: 'file_manager',
      image: 'gallery',
      document: 'file_manager',
    });
  });

  it('routes date, region, and default-open preferences into typed OS state', () => {
    routeSetPreference('system_24_hour_format', false, { source: 'settings' });
    routeSetPreference('system_time_zone', 'America/Los_Angeles', { source: 'settings' });
    routeSetPreference('system_region', 'US', { source: 'settings' });
    routeSetPreference('secure_default_open_pdf', null, { source: 'settings' });
    routeSetPreference('secure_default_open_image', null, { source: 'settings' });
    routeSetPreference('secure_default_open_document', null, { source: 'settings' });

    expect(routeGetPreference('system_24_hour_format')).toBe(false);
    expect(routeGetPreference('system_time_zone')).toBe('America/Los_Angeles');
    expect(routeGetPreference('system_region')).toBe('US');
    expect(routeGetPreference('secure_default_open_pdf')).toBeNull();
    expect(routeGetPreference('secure_default_open_image')).toBeNull();
    expect(routeGetPreference('secure_default_open_document')).toBeNull();

    const { system, secure } = OsStateStore.getState().settings;
    expect(system).toMatchObject({
      use24HourFormat: false,
      timeZone: 'America/Los_Angeles',
      region: 'US',
    });
    expect(secure.defaultOpenHandlers).toEqual({ pdf: null, image: null, document: null });
  });

  it('keeps manual time disabled in automatic mode and switches TimeService modes', () => {
    const manualTimestamp = TimeService.fromLocalParts(2027, 0, 2, 3, 4, 5).getTime();

    routeSetPreference('system_manual_time', manualTimestamp, { source: 'settings' });
    expect(routeGetPreference('system_manual_time')).toBeNull();
    expect(TimeService.getTimeConfig().mode).toBe('real');

    routeSetPreference('system_automatic_date_time', false, { source: 'settings' });
    expect(routeGetPreference('system_automatic_date_time')).toBe(false);
    expect(TimeService.getTimeConfig()).toMatchObject({ mode: 'simulated', flowing: true });

    routeSetPreference('system_manual_time', manualTimestamp, { source: 'settings' });
    expect(routeGetPreference('system_manual_time')).toBe(manualTimestamp);
    expect(Math.abs(TimeService.now() - manualTimestamp)).toBeLessThan(1_000);

    routeSetPreference('system_automatic_date_time', true, { source: 'settings' });
    expect(routeGetPreference('system_automatic_date_time')).toBe(true);
    expect(TimeService.getTimeConfig().mode).toBe('real');
  });

  it('round-trips manual wall-clock input in the selected IANA time zone', async () => {
    const { parseZonedDateTimeInput, toZonedDateTimeInput } = await import(
      '../system/Settings/components/DateTimeRegionPage'
    );
    const value = '2027-07-10T12:34';
    const timestamp = parseZonedDateTimeInput(value, 'America/Los_Angeles');

    expect(timestamp).not.toBeNull();
    expect(toZonedDateTimeInput(timestamp as number, 'America/Los_Angeles')).toBe(value);
    // This local time is skipped when Los Angeles enters daylight saving time.
    expect(parseZonedDateTimeInput('2027-03-14T02:30', 'America/Los_Angeles')).toBeNull();
  });

  it('measures real private files and clears only recognized cache children', async () => {
    const graph = seedPrivateStorage();
    const {
      clearApplicationCache,
      getApplicationPrivateStorageStats,
    } = await import('../system/Settings/components/ApplicationDetailPage');

    expect(getApplicationPrivateStorageStats('wechat')).toEqual({
      totalBytes: 150,
      cacheBytes: 100,
      privateRoot: '/data/data/wechat',
      cacheDirectories: [
        '/data/data/wechat/cache',
        '/data/data/wechat/code_cache',
        '/data/data/wechat/tmp',
        '/data/data/wechat/files/cache',
      ],
    });

    await expect(clearApplicationCache('wechat')).resolves.toEqual({
      removedEntries: 5,
      freedBytes: 100,
    });

    expect(graph.has('/data/data/wechat/cache')).toBe(true);
    expect(graph.has('/data/data/wechat/code_cache')).toBe(true);
    expect(graph.has('/data/data/wechat/tmp')).toBe(true);
    expect(graph.has('/data/data/wechat/files/cache')).toBe(true);
    expect(graph.has('/data/data/wechat/cache/thumb.bin')).toBe(false);
    expect(graph.has('/data/data/wechat/files/cache/previews/page.png')).toBe(false);
    expect(graph.has('/data/data/wechat/files/user.db')).toBe(true);
    expect(graph.has('/data/data/wechat_beta/cache/not-yours.bin')).toBe(true);
    expect(fsMock.deleteNode).not.toHaveBeenCalledWith('/data/data/wechat/files/user.db');
  });

  it('declares application and manual-time actions in URL-backed settings states', () => {
    const settingsRoute = NAVIGATION_DECLARATION.routes.find(
      (route) => route.path === '/page/:pageId',
    );
    const actionIds = settingsRoute?.uiStates.flatMap((state) => (
      'actions' in state ? (state.actions ?? []).map((action) => action.id) : []
    )) ?? [];

    expect(actionIds).toEqual(expect.arrayContaining([
      'settings.app.cache.clear',
      'settings.app.defaultOpen.set',
      'settings.datetime.manual.submit',
    ]));
  });
});

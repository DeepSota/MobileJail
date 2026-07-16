import { afterEach, describe, expect, it } from 'vitest';
import { mimeTypesMatch } from '@/os/MimeType';
import PackageManagerService from '@/os/PackageManagerService';
import type { AppManifest } from '@/os/types/manifest';
import { IntentAvailabilityRegistry } from '@/os/IntentAvailabilityRegistry';
import { resolveDefaultOpenApp } from '@/os/IntentResolver';
import { mutateOsState } from '@/os/OsStateStore';

const TEST_APP_ID = '__intent_mime_test__';

const testManifest: AppManifest = {
  id: TEST_APP_ID,
  packageName: 'test.intent.mime',
  displayName: 'Intent MIME Test',
  version: '1.0.0',
  versionCode: 1,
  type: 'system',
  icon: '',
  iconBackground: '#000000',
  theme: {
    colors: {
      primary: '#000000',
      background: '#ffffff',
      textPrimary: '#000000',
      textSecondary: '#666666',
      statusBarForeground: 'dark',
    },
  },
  intentFilters: [
    { action: 'ACTION_SEND', type: 'image/*', route: '/generic-image' },
    { action: 'ACTION_SEND', type: 'image/png', route: '/exact-png' },
  ],
};

describe('Intent MIME matching and chooser de-duplication', () => {
  afterEach(() => {
    PackageManagerService.uninstall(TEST_APP_ID);
    IntentAvailabilityRegistry.clear('tencent_meeting.active_meeting');
    mutateOsState((state) => { state.settings.secure.defaultOpenHandlers.image = null; });
  });

  it('matches wildcards on either the filter or Intent side', () => {
    expect(mimeTypesMatch('image/*', 'image/png')).toBe(true);
    expect(mimeTypesMatch('image/png', 'image/*')).toBe(true);
    expect(mimeTypesMatch('application/pdf', '*/*')).toBe(true);
    expect(mimeTypesMatch('image/*', 'application/pdf')).toBe(false);
  });

  it('returns one chooser entry per App and keeps its most specific filter', () => {
    PackageManagerService.install(testManifest);

    const matches = PackageManagerService.queryIntentActivities({
      action: 'ACTION_SEND',
      type: 'image/png',
    }).filter((match) => match.appId === TEST_APP_ID);

    expect(matches).toHaveLength(1);
    expect(matches[0].filter.route).toBe('/exact-png');
  });

  it('exposes file-capable messaging Apps and gates Meeting by active session', () => {
    const matches = PackageManagerService.queryIntentActivities({
      action: 'ACTION_SEND_MULTIPLE',
      type: 'application/octet-stream',
    }).map((match) => match.appId);

    expect(matches).toEqual(expect.arrayContaining([
      'wechat',
      'sms',
      'mail',
      'alipay',
      'bilibili',
      'redbook',
      'x',
    ]));
    expect(matches).not.toContain('tencent_meeting');

    IntentAvailabilityRegistry.set('tencent_meeting.active_meeting', true);
    expect(PackageManagerService.resolveActivityAll({
      action: 'ACTION_SEND_MULTIPLE',
      type: 'application/octet-stream',
    })).toContain('tencent_meeting');
  });

  it('routes a text/plain file to file receivers instead of text-compose routes', () => {
    const matches = PackageManagerService.queryIntentActivities({
      action: 'ACTION_SEND',
      type: 'text/plain',
      data: {
        sharePayload: {
          version: 1,
          mimeType: 'text/plain',
          files: [{ version: 1, fileId: 'txt', uri: 'content://simfs/files/txt' }],
        },
      },
    });

    expect(matches.find((match) => match.appId === 'wechat')?.filter.route).toBe('/share/forward');
    expect(matches.find((match) => match.appId === 'redbook')?.filter.route).toBe('/share');
    expect(matches.map((match) => match.appId)).not.toContain('notes');
  });

  it('does not expose non-consuming Gallery/Notes targets for file payloads', () => {
    const imageTargets = PackageManagerService.resolveActivityAll({
      action: 'ACTION_SEND',
      type: 'image/png',
      data: {
        sharePayload: {
          version: 1,
          mimeType: 'image/png',
          files: [{ version: 1, fileId: 'image', uri: 'content://simfs/files/image' }],
        },
      },
    });

    expect(imageTargets).not.toContain('gallery');
    expect(imageTargets).not.toContain('notes');
    expect(imageTargets).toEqual(expect.arrayContaining([
      'wechat',
      'sms',
      'mail',
      'alipay',
      'bilibili',
      'redbook',
      'x',
    ]));

    const textTargets = PackageManagerService.resolveActivityAll({
      action: 'ACTION_SEND',
      type: 'text/plain',
      data: { text: 'plain shared text' },
    });
    expect(textTargets).toContain('notes');
  });

  it('does not claim unknown application/octet-stream files can be viewed', () => {
    expect(PackageManagerService.resolveActivityAll({
      action: 'ACTION_VIEW',
      type: 'application/octet-stream',
      scheme: 'content',
    })).not.toContain('file_manager');
  });

  it('uses a valid Settings default handler without showing a chooser', () => {
    const intent = { action: 'ACTION_VIEW', type: 'image/png' };
    const matches = PackageManagerService.queryIntentActivities(intent);
    mutateOsState((state) => { state.settings.secure.defaultOpenHandlers.image = 'gallery'; });

    expect(resolveDefaultOpenApp(intent, matches)).toBe('gallery');
    mutateOsState((state) => { state.settings.secure.defaultOpenHandlers.image = 'missing-app'; });
    expect(resolveDefaultOpenApp(intent, matches)).toBeNull();
  });
});

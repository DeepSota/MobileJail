import { beforeEach, describe, expect, it } from 'vitest';
import { NAVIGATION_DECLARATION } from '../system/Settings/navigation.declaration';
import {
  resolveSettingsPageId,
  resolveSettingsPreferenceKey,
} from '../system/Settings/data/settingsMappings';
import { defaultOsState, OsStateStore } from '../os/OsStateStore';
import { routeGetPreference, routeSetPreference } from '../os/managers/registry';

describe('Settings compatibility mappings', () => {
  beforeEach(() => {
    OsStateStore.setState(structuredClone(defaultOsState), true);
  });

  it('routes extracted high-frequency preference keys to canonical OS keys', () => {
    expect(resolveSettingsPreferenceKey('toggle_airplane')).toBe('airplane_mode');
    expect(resolveSettingsPreferenceKey('airplane_mode_on')).toBe('airplane_mode');
    expect(resolveSettingsPreferenceKey('main_toggle_wifi')).toBe('wifi_enable');
    expect(resolveSettingsPreferenceKey('wifi_tether')).toBe('wifi_hotspot_enable');
    expect(resolveSettingsPreferenceKey('vpn_enable')).toBe('vpn_enabled');
    expect(resolveSettingsPreferenceKey('toggle_nfc')).toBe('nfc_enabled');
    expect(resolveSettingsPreferenceKey('multiple_positioning_mode')).toBe('location_enabled');
    expect(resolveSettingsPreferenceKey('media_volume')).toBe('media_volume');
  });

  it('repairs common extracted Fragment targets without changing pages.json', () => {
    expect(resolveSettingsPageId('PowerUsageSummary')).toBe('power_usage_summary_screen');
    expect(resolveSettingsPageId('ManageApplications')).toBe('applications_settings');
    expect(resolveSettingsPageId('NotificationAppListSettings')).toBe('notification_managing');
    expect(resolveSettingsPageId('PermissonManagerContainer')).toBe('permission_managing');
    expect(resolveSettingsPageId('display_settings_screen')).toBe('display_settings_screen');
  });

  it('writes NFC and location switches into the canonical global OS state', () => {
    routeSetPreference(resolveSettingsPreferenceKey('toggle_nfc'), true, { source: 'settings' });
    routeSetPreference(resolveSettingsPreferenceKey('multiple_positioning_mode'), false, { source: 'settings' });

    expect(OsStateStore.getState().settings.global.nfcEnabled).toBe(true);
    expect(OsStateStore.getState().settings.global.locationEnabled).toBe(false);
    expect(routeGetPreference('nfc_enabled')).toBe(true);
    expect(routeGetPreference('location_enabled')).toBe(false);
  });
});

describe('Settings navigation contract', () => {
  it('declares URL-backed dialog states and their system-back entry transitions', () => {
    const route = NAVIGATION_DECLARATION.routes.find((item) => item.path === '/page/:pageId');
    expect(route).toBeDefined();
    expect(route?.uiStates.map((state) => ('dialog' in state.search ? state.search.dialog : undefined)).filter(Boolean)).toEqual([
      'list',
      'value',
      'wifiPassword',
      'wifiSsid',
      'bluetoothName',
    ]);
    expect(NAVIGATION_DECLARATION.transitions.some((item) => item.id === 'dialog.open')).toBe(true);
    expect(NAVIGATION_DECLARATION.transitions.some((item) => item.id === 'wifi.password.open')).toBe(true);
  });

});

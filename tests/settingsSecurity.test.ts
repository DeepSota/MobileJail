import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultOsState, OsStateStore } from '../os/OsStateStore';
import {
  changeSecurePin,
  clearSecurePin,
  hasSecurePin,
  isValidSecurePin,
  routeGetPreference,
  routeSetPreference,
  setSecurePin,
  verifySecurePin,
} from '../os/managers/registry';
import { NAVIGATION_DECLARATION } from '../system/Settings/navigation.declaration';
import { CLIPBOARD_ACCESS_EVENT, ClipboardService } from '../os/ClipboardService';

describe('Settings secure device state', () => {
  beforeEach(() => {
    OsStateStore.setState(structuredClone(defaultOsState), true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('starts with safe persistent-domain defaults', () => {
    const secure = OsStateStore.getState().settings.secure;
    expect(secure.lockScreen.method).toBe('none');
    expect(secure.lockScreen.credential).toBeNull();
    expect(secure.lockScreen.fingerprintEnabled).toBe(false);
    expect(secure.lockScreen.faceEnabled).toBe(false);
    expect(secure.privacy.unknownSourcesAllowed).toBe(false);
    expect(secure.privacy.appScanningEnabled).toBe(true);
    expect(secure.emergency.wirelessAlertsEnabled).toBe(true);
  });

  it('stores only a salted SHA-256 PIN digest and verifies it', async () => {
    expect(isValidSecurePin('2468')).toBe(true);
    expect(isValidSecurePin('12ab')).toBe(false);
    expect(await setSecurePin('2468')).toBe(true);

    const lockScreen = OsStateStore.getState().settings.secure.lockScreen;
    expect(lockScreen.method).toBe('pin');
    expect(lockScreen.credential).toMatchObject({ algorithm: 'SHA-256' });
    expect(lockScreen.credential?.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(lockScreen.credential?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(lockScreen)).not.toContain('2468');
    expect(hasSecurePin()).toBe(true);
    expect(await verifySecurePin('2468')).toBe(true);
    expect(await verifySecurePin('1357')).toBe(false);
    expect(await setSecurePin('1357')).toBe(false);
    expect(await verifySecurePin('2468')).toBe(true);
  });

  it('requires current-PIN verification before changing or clearing it', async () => {
    await setSecurePin('2468');

    expect(await changeSecurePin('0000', '1357')).toBe(false);
    expect(await verifySecurePin('2468')).toBe(true);
    expect(await changeSecurePin('2468', '1357')).toBe(true);
    expect(await verifySecurePin('2468')).toBe(false);
    expect(await verifySecurePin('1357')).toBe(true);

    routeSetPreference('secure_fingerprint_enabled', true, { source: 'settings' });
    routeSetPreference('secure_face_enabled', true, { source: 'settings' });
    routeSetPreference('secure_show_sensitive_notifications', true, { source: 'settings' });
    expect(await clearSecurePin('0000')).toBe(false);
    expect(await clearSecurePin('1357')).toBe(true);

    const lockScreen = OsStateStore.getState().settings.secure.lockScreen;
    expect(lockScreen.method).toBe('none');
    expect(lockScreen.credential).toBeNull();
    expect(lockScreen.fingerprintEnabled).toBe(false);
    expect(lockScreen.faceEnabled).toBe(false);
    expect(lockScreen.showSensitiveNotifications).toBe(false);
  });

  it('routes security, privacy and emergency preferences into the secure domain', async () => {
    routeSetPreference('secure_fingerprint_enabled', true, { source: 'settings' });
    expect(routeGetPreference('secure_fingerprint_enabled')).toBe(false);

    await setSecurePin('2468');
    routeSetPreference('secure_fingerprint_enabled', true, { source: 'settings' });
    routeSetPreference('secure_lock_screen_notifications', false, { source: 'settings' });
    routeSetPreference('secure_show_sensitive_notifications', true, { source: 'settings' });
    routeSetPreference('secure_camera_access_enabled', false, { source: 'settings' });
    routeSetPreference('secure_unknown_sources_allowed', true, { source: 'settings' });
    routeSetPreference('secure_auto_lock_seconds', '300', { source: 'settings' });
    routeSetPreference('secure_sos_enabled', true, { source: 'settings' });
    routeSetPreference('secure_sos_trigger', 'hold_power_volume', { source: 'settings' });
    routeSetPreference('secure_emergency_location_enabled', false, { source: 'settings' });

    const secure = OsStateStore.getState().settings.secure;
    expect(secure.lockScreen.fingerprintEnabled).toBe(true);
    expect(secure.lockScreen.notificationsEnabled).toBe(false);
    expect(secure.lockScreen.showSensitiveNotifications).toBe(false);
    expect(secure.lockScreen.autoLockSeconds).toBe(300);
    expect(secure.privacy.cameraAccessEnabled).toBe(false);
    expect(secure.privacy.unknownSourcesAllowed).toBe(true);
    expect(secure.emergency.sosEnabled).toBe(true);
    expect(secure.emergency.trigger).toBe('hold_power_volume');
    expect(secure.emergency.emergencyLocationEnabled).toBe(false);
  });

  it('shows clipboard-read alerts only while the privacy control is enabled', () => {
    let activeAppId = 'wechat';
    const dispatchEvent = vi.fn(() => true);
    vi.stubGlobal('window', {
      __OS__: { getState: () => ({ activeAppId }) },
      dispatchEvent,
    });

    ClipboardService.copyText('clipboard privacy check', 'settings-test');
    expect(ClipboardService.getText()).toBe('clipboard privacy check');
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: CLIPBOARD_ACCESS_EVENT,
    }));

    routeSetPreference('secure_clipboard_access_alerts', false, { source: 'settings' });
    activeAppId = 'mail';
    ClipboardService.getText();
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('declares URL-backed PIN flow without exposing PIN values in action params', () => {
    const route = NAVIGATION_DECLARATION.routes.find((item) => item.path === '/page/:pageId');
    expect(route?.uiStates.some((state) => state.id === 'settings.page.dialog.value')).toBe(true);
    expect(NAVIGATION_DECLARATION.transitions.some((transition) => transition.id === 'security.pin.step')).toBe(true);
    const securityState = route?.uiStates.find((state) => state.id === 'settings.page.dialog.value');
    const pinAction = securityState && 'actions' in securityState
      ? securityState.actions?.find((action) => action.id === 'settings.security.pin.submit')
      : undefined;
    expect(pinAction?.paramsSchema).toEqual({ operation: 'string' });
  });
});

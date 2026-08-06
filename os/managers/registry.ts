import * as TimeService from '../TimeService';
import {
  useRealTime as activateRealTime,
  useSimulatedTime as activateSimulatedTime,
} from '../TimeService';
import { OS_DEFAULTS } from '../data';
import type { DeviceInfoPreset, SimInfoPreset } from '../data/types';
import {
  mutateOsState,
  OS_SUPPORTED_REGIONS,
  OS_SUPPORTED_TIME_ZONES,
  useOsStateStore,
  type OsDefaultOpenCategory,
  type OsPinCredential,
  type OsSosTrigger,
} from '../OsStateStore';
import { getLocale, setLocale, type Locale } from '../locale';

export type DeviceSettingValue = string | number | boolean | null;
export type DeviceSetOptions = { source?: 'os' | 'settings' | 'device' | 'external' };

export interface ManagerWithPreferences {
  getPreference(key: string): DeviceSettingValue | undefined;
  setPreference(key: string, value: DeviceSettingValue, options?: DeviceSetOptions): void;
}

type ChangeListener = () => void;
type BuildOverrides = Partial<DeviceInfoPreset>;
type TelephonyOverrides = Partial<{
  sims: SimInfoPreset[];
  defaultDataSim: 1 | 2;
  defaultCallsSim: 1 | 2 | 0;
  defaultSmsSim: 1 | 2 | 0;
}>;

const keyToManager = new Map<string, ManagerWithPreferences>();
const changeListeners = new Set<ChangeListener>();
const bootAtMs = TimeService.now();

const SCENARIO_OVERRIDES_KEY = '__os_scenario_overrides__';

interface ScenarioOverrides {
  build?: BuildOverrides;
  telephony?: TelephonyOverrides;
}

function loadPersistedJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch { /* ignore corrupt data */ }
  return fallback;
}

function persistScenarioOverrides(): void {
  try {
    const payload: ScenarioOverrides = {};
    if (Object.keys(buildOverrides).length > 0) payload.build = buildOverrides;
    if (Object.keys(telephonyOverrides).length > 0) payload.telephony = telephonyOverrides;
    if (Object.keys(payload).length > 0) {
      localStorage.setItem(SCENARIO_OVERRIDES_KEY, JSON.stringify(payload));
    } else {
      localStorage.removeItem(SCENARIO_OVERRIDES_KEY);
    }
  } catch { /* ignore quota errors */ }
}

function loadScenarioOverrides(): ScenarioOverrides {
  return loadPersistedJson<ScenarioOverrides>(SCENARIO_OVERRIDES_KEY, {});
}

const _loaded = loadScenarioOverrides();
let buildOverrides: BuildOverrides = _loaded.build ?? {};
let telephonyOverrides: TelephonyOverrides = _loaded.telephony ?? {};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function clampString(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const next = value.trim();
  return next || fallback;
}

const VALID_SOS_TRIGGERS = new Set<OsSosTrigger>([
  'power_button_5',
  'power_button_3',
  'hold_power_volume',
]);

export const SYSTEM_TIME_ZONES = OS_SUPPORTED_TIME_ZONES;

export const SYSTEM_REGIONS = OS_SUPPORTED_REGIONS;

const VALID_SYSTEM_TIME_ZONES = new Set<string>(SYSTEM_TIME_ZONES);
const VALID_SYSTEM_REGIONS = new Set<string>(SYSTEM_REGIONS);

function getDefaultOpenCategory(key: string): OsDefaultOpenCategory | null {
  const match = /^secure_default_open_(pdf|image|document)$/.exec(key);
  return match ? match[1] as OsDefaultOpenCategory : null;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hashPin(pin: string, salt: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Secure credential hashing is unavailable');
  const data = new TextEncoder().encode(`${salt}\u0000${pin}`);
  const digest = await subtle.digest('SHA-256', data);
  return toHex(new Uint8Array(digest));
}

function createPinSalt(): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) throw new Error('Secure random generation is unavailable');
  return toHex(cryptoApi.getRandomValues(new Uint8Array(16)));
}

function secureStringEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

export function isValidSecurePin(pin: string): boolean {
  return /^\d{4,8}$/.test(String(pin ?? '').trim());
}

export function hasSecurePin(): boolean {
  const lockScreen = useOsStateStore.getState().settings.secure.lockScreen;
  return lockScreen.method === 'pin' && !!lockScreen.credential;
}

export async function verifySecurePin(pin: string): Promise<boolean> {
  const credential = useOsStateStore.getState().settings.secure.lockScreen.credential;
  if (!credential || !isValidSecurePin(pin)) return false;
  const candidate = await hashPin(String(pin).trim(), credential.salt);
  return secureStringEqual(candidate, credential.hash);
}

async function buildPinCredential(pin: string): Promise<OsPinCredential | null> {
  const normalized = String(pin ?? '').trim();
  if (!isValidSecurePin(normalized)) return null;
  const salt = createPinSalt();
  return {
    algorithm: 'SHA-256',
    salt,
    hash: await hashPin(normalized, salt),
    changedAt: TimeService.now(),
  };
}

async function writeSecurePin(pin: string): Promise<boolean> {
  const credential = await buildPinCredential(pin);
  if (!credential) return false;
  mutateOsState((state) => {
    state.settings.secure.lockScreen.method = 'pin';
    state.settings.secure.lockScreen.credential = credential;
  });
  return true;
}

export async function setSecurePin(pin: string): Promise<boolean> {
  if (hasSecurePin()) return false;
  return writeSecurePin(pin);
}

export async function changeSecurePin(currentPin: string, nextPin: string): Promise<boolean> {
  if (!(await verifySecurePin(currentPin))) return false;
  return writeSecurePin(nextPin);
}

export async function clearSecurePin(currentPin: string): Promise<boolean> {
  if (!(await verifySecurePin(currentPin))) return false;
  mutateOsState((state) => {
    const lockScreen = state.settings.secure.lockScreen;
    lockScreen.method = 'none';
    lockScreen.credential = null;
    lockScreen.fingerprintEnabled = false;
    lockScreen.faceEnabled = false;
    lockScreen.showSensitiveNotifications = false;
  });
  return true;
}

function getDefaultBrandedAccountName(): string {
  return getLocale() === 'en' ? 'Xiaomi User' : '小米用户';
}

function formatUptime(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  if (days > 0) return `${days}天 ${hours}小时`;
  if (hours > 0) return `${hours}小时 ${minutes}分钟`;
  return `${minutes}分钟`;
}

function cloneSims(list: SimInfoPreset[]): SimInfoPreset[] {
  return list.map((sim) => ({ ...sim }));
}

function emitChange(): void {
  changeListeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      console.error('[PreferenceRegistry] listener failed', error);
    }
  });
}

function normalizeBuildOverrideValue<K extends keyof DeviceInfoPreset>(
  key: K,
  value: DeviceSettingValue,
): DeviceInfoPreset[K] | undefined {
  if (value == null) return undefined;
  if (key === 'cpuCores' || key === 'screenDensity' || key === 'refreshRate') {
    const next = Number(value);
    return (Number.isFinite(next) ? next : undefined) as DeviceInfoPreset[K];
  }
  if (key === 'hdrSupport') {
    return Boolean(value) as DeviceInfoPreset[K];
  }
  return String(value) as DeviceInfoPreset[K];
}

export function normalizePreferenceKey(key: string): string {
  const k = String(key ?? '').trim();
  if (!k) return '';

  if (k === '@string/preference_key_brightness_level') return 'brightness';
  if (k === '@string/preference_key_auto_brightness') return 'auto_brightness';

  if (k === 'wifi_enable') return 'wifi_enabled';
  if (k === 'bluetooth_enable') return 'bluetooth_enabled';
  if (k === 'mobile_data_enable') return 'mobile_data_enabled';
  if (k === 'airplane_mode') return 'airplane_mode_enabled';
  if (k === 'enable_wifi_ap' || k === 'wifi_hotspot_enable') return 'hotspot_enabled';
  if (k === 'wifi_tether_network_name' || k === 'wifi_tether_network_name_2') return 'hotspot_ssid';
  if (k === 'wifi_tether_network_password' || k === 'wifi_tether_network_password_2') return 'hotspot_password';
  if (k === 'battery_saver') return 'battery_saver';
  if (k === 'phone_language') return 'language';
  if (k === 'notif.app.calendar.enabled') return 'calendar_notification_enabled';

  if (k === 'brightness') return 'brightness';
  if (k === 'auto_brightness' || k === 'brightness_auto_mode_enable') return 'auto_brightness';

  if (k === 'media_volume' || k === 'setting_volume') return 'volume_media';
  if (k === 'ring_volume') return 'volume_ring';
  if (k === 'alarm_volume') return 'volume_alarm';
  if (k === 'notification_volume') return 'volume_notification';
  if (k === 'separate_ring_volume') return 'volume_ring';
  if (k === 'call_volume') return 'volume_call';
  if (k === 'voice_assist_volume') return 'volume_voice_assist';

  if (k === 'silent_mode' || k === 'ringer_mode_setting') return 'silent';

  if (k === 'dark_ui_mode' || k === 'dark_mode_display_enable') return 'dark_mode';
  if (k === 'eye_comfort' || k === 'eye_comfort_mode' || k === 'eye_protection') return 'eye_comfort';
  if (k === 'paper_mode_enable') return 'eye_comfort';
  if (k === 'paper_mode_adjust_level' || k === 'adjust_paper_mode') return 'eye_comfort_level';
  if (k === 'key_do_not_disturb_mode' || k === 'do_not_disturb_mode' || k === 'zen_mode') return 'do_not_disturb';

  if (k === 'font_size') return 'font_size';
  if (k === 'display_size') return 'display_size';

  if (k === 'number') return 'phone_number';
  if (k === 'imei') return 'imei_info';
  if (k === 'icc_id' || k === 'iccid') return 'iccid';

  return k;
}

export function getEffectiveBuildInfo(): DeviceInfoPreset {
  return {
    ...(OS_DEFAULTS.build as DeviceInfoPreset),
    ...buildOverrides,
  };
}

export function getEffectiveTelephony(): { sims: SimInfoPreset[]; defaultDataSim: 1 | 2; defaultCallsSim: 1 | 2 | 0; defaultSmsSim: 1 | 2 | 0 } {
  const defaults = OS_DEFAULTS.telephony as { sims: SimInfoPreset[]; defaultDataSim: 1 | 2; defaultCallsSim?: 1 | 2 | 0; defaultSmsSim?: 1 | 2 | 0 };
  return {
    sims: cloneSims(telephonyOverrides.sims ?? defaults.sims),
    defaultDataSim: telephonyOverrides.defaultDataSim ?? defaults.defaultDataSim,
    defaultCallsSim: telephonyOverrides.defaultCallsSim ?? defaults.defaultCallsSim ?? defaults.defaultDataSim,
    defaultSmsSim: telephonyOverrides.defaultSmsSim ?? defaults.defaultSmsSim ?? defaults.defaultDataSim,
  };
}

export function setBuildOverrides(patch: Partial<DeviceInfoPreset>): void {
  if (!isRecord(patch)) return;
  let changed = false;
  const next: BuildOverrides = { ...buildOverrides };
  (Object.keys(patch) as Array<keyof DeviceInfoPreset>).forEach((key) => {
    const normalized = normalizeBuildOverrideValue(key, patch[key] as DeviceSettingValue);
    if (normalized === undefined) return;
    if (next[key] === normalized) return;
    (next as Record<string, unknown>)[key as string] = normalized;
    changed = true;
  });
  if (!changed) return;
  buildOverrides = next;
  persistScenarioOverrides();
  emitChange();
}

export function setTelephonyOverrides(patch: TelephonyOverrides): void {
  if (!isRecord(patch)) return;
  let changed = false;
  const next: TelephonyOverrides = { ...telephonyOverrides };
  if (Array.isArray(patch.sims)) {
    next.sims = cloneSims(patch.sims);
    changed = true;
  }
  if (patch.defaultDataSim === 1 || patch.defaultDataSim === 2) {
    next.defaultDataSim = patch.defaultDataSim;
    changed = true;
  }
  if (patch.defaultCallsSim === 0 || patch.defaultCallsSim === 1 || patch.defaultCallsSim === 2) {
    next.defaultCallsSim = patch.defaultCallsSim;
    changed = true;
  }
  if (patch.defaultSmsSim === 0 || patch.defaultSmsSim === 1 || patch.defaultSmsSim === 2) {
    next.defaultSmsSim = patch.defaultSmsSim;
    changed = true;
  }
  if (!changed) return;
  telephonyOverrides = next;
  persistScenarioOverrides();
  emitChange();
}

export function subscribePreferenceChanges(listener: ChangeListener): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

export function registerManager(keys: readonly string[], manager: ManagerWithPreferences): void {
  keys.forEach((key) => {
    const normalized = normalizePreferenceKey(key);
    if (normalized) {
      keyToManager.set(normalized, manager);
    }
  });
}



function getDefaultSim(): SimInfoPreset | undefined {
  const telephony = getEffectiveTelephony();
  const slot = telephony.defaultDataSim === 2 ? 2 : 1;
  return telephony.sims.find((sim) => sim.slot === slot) ?? telephony.sims[0];
}

function genericGetPreference(normalizedKey: string): DeviceSettingValue | undefined {
  const state = useOsStateStore.getState();
  const prefs = state.preferences;
  const build = getEffectiveBuildInfo();
  const telephony = getEffectiveTelephony();

  switch (normalizedKey) {
    case 'language':
      return getLocale();
    case 'nfc_enabled':
      return state.settings.global.nfcEnabled;
    case 'location_enabled':
      return state.settings.global.locationEnabled;
    case 'hotspot_ssid':
      return state.hardware.hotspot.ssid;
    case 'hotspot_password':
      return state.hardware.hotspot.password;
    case 'system_24_hour_format':
      return state.settings.system.use24HourFormat;
    case 'system_automatic_date_time':
      return state.settings.system.automaticDateTime;
    case 'system_time_zone':
      return state.settings.system.timeZone;
    case 'system_region':
      return state.settings.system.region;
    case 'system_manual_time':
      return state.settings.system.manualTime;
    case 'secure_auto_lock_seconds':
      return String(state.settings.secure.lockScreen.autoLockSeconds);
    case 'secure_power_button_locks':
      return state.settings.secure.lockScreen.powerButtonLocks;
    case 'secure_lock_screen_notifications':
      return state.settings.secure.lockScreen.notificationsEnabled;
    case 'secure_show_sensitive_notifications':
      return state.settings.secure.lockScreen.showSensitiveNotifications;
    case 'secure_fingerprint_enabled':
      return state.settings.secure.lockScreen.fingerprintEnabled;
    case 'secure_face_enabled':
      return state.settings.secure.lockScreen.faceEnabled;
    case 'secure_find_device_enabled':
      return state.settings.secure.privacy.findDeviceEnabled;
    case 'secure_app_scanning_enabled':
      return state.settings.secure.privacy.appScanningEnabled;
    case 'secure_unknown_sources_allowed':
      return state.settings.secure.privacy.unknownSourcesAllowed;
    case 'secure_camera_access_enabled':
      return state.settings.secure.privacy.cameraAccessEnabled;
    case 'secure_microphone_access_enabled':
      return state.settings.secure.privacy.microphoneAccessEnabled;
    case 'secure_clipboard_access_alerts':
      return state.settings.secure.privacy.clipboardAccessAlertsEnabled;
    case 'secure_sos_enabled':
      return state.settings.secure.emergency.sosEnabled;
    case 'secure_sos_trigger':
      return state.settings.secure.emergency.trigger;
    case 'secure_sos_countdown_sound':
      return state.settings.secure.emergency.countdownSoundEnabled;
    case 'secure_emergency_location_enabled':
      return state.settings.secure.emergency.emergencyLocationEnabled;
    case 'secure_wireless_alerts_enabled':
      return state.settings.secure.emergency.wirelessAlertsEnabled;
    case 'device_system_version':
      return build.systemVersion;
    case 'firmware_version':
      return build.androidVersion;
    case 'security_patch':
      return build.securityPatch;
    case 'model_number':
    case 'hardware_info_device_model':
    case 'device_model':
      return build.model;
    case 'model_name':
      return build.marketName;
    case 'device_cpu':
      return build.processor;
    case 'device_memory':
    case 'key_storage_total_size':
      return build.ramTotal;
    case 'device_internal_memory':
      return build.storageTotal;
    case 'device_internal_memory_used':
      return useOsStateStore.getState().hardware.storage.used;
    case 'baseband_version':
      return build.basebandVersion;
    case 'kernel_version':
      return build.kernelVersion;
    case 'hardware_version':
    case 'hardware_info_device_revision':
      return prefs.hardware_version ?? 'V1.0';
    case 'hardware_info_device_serial':
      return build.serialNumber;
    case 'imei_info':
      return build.imei1;
    case 'bt_address':
      return build.bluetoothMac;
    case 'wifi_mac_address':
      return build.macAddress;
    case 'slot0_phone_number': {
      const sim = telephony.sims.find((item) => item.slot === 1);
      if (!sim) return '无 SIM';
      return sim.phoneNumber || '未设置';
    }
    case 'slot1_phone_number': {
      const sim = telephony.sims.find((item) => item.slot === 2);
      if (!sim) return '无 SIM';
      return sim.phoneNumber || '未设置';
    }
    case 'phone_number': {
      const sim = getDefaultSim();
      if (!sim) return '无 SIM';
      return sim.phoneNumber || '未设置';
    }
    case 'iccid': {
      const sim = getDefaultSim();
      if (!sim) return '无 SIM';
      return sim.iccid || '未设置';
    }
    case 'operator_name': {
      const sim = getDefaultSim();
      if (!sim) return '无 SIM';
      return sim.carrier || '未知运营商';
    }
    case 'roaming_state': {
      const sim = getDefaultSim();
      if (!sim) return '无 SIM';
      return sim.dataRoaming ? '已开启' : '已关闭';
    }
    case 'sim_status': {
      const sim = getDefaultSim();
      if (!sim) return '无 SIM';
      return `${sim.carrier} ${sim.networkType}`.trim();
    }
    case 'imei_sv':
      return prefs.imei_sv ?? '00';
    case 'up_time':
      return formatUptime(TimeService.now() - bootAtMs);
    case 'device_opcust_version':
      return prefs.device_opcust_version ?? build.buildNumber;
    case 'software_version':
      return build.buildNumber;
    case 'branded_account':
      return prefs.branded_account ?? getDefaultBrandedAccountName();
    case 'eid_info':
      return prefs.eid_info ?? '89***************';
    case 'fcc_equipment_id':
      return prefs.fcc_equipment_id ?? 'FCC ID: 2A********';
    case 'micare_expiry_time':
      return prefs.micare_expiry_time ?? '未知';
    // --- SIM-slot-specific telephony reads ---
    case 'default_data_sim':
      return String(telephony.defaultDataSim);
    case 'default_calls_sim':
      return String(telephony.defaultCallsSim);
    case 'default_sms_sim':
      return String(telephony.defaultSmsSim);
    case 'network_type_sim1': {
      const sim = telephony.sims.find((item) => item.slot === 1);
      return sim ? sim.networkType || '未知' : '无 SIM';
    }
    case 'network_type_sim2': {
      const sim = telephony.sims.find((item) => item.slot === 2);
      return sim ? sim.networkType || '未知' : '无 SIM';
    }
    case 'operator_name_sim2': {
      const sim = telephony.sims.find((item) => item.slot === 2);
      return sim ? sim.carrier || '未知运营商' : '无 SIM';
    }
    case 'roaming_state_sim2': {
      const sim = telephony.sims.find((item) => item.slot === 2);
      return sim ? (sim.dataRoaming ? '已开启' : '已关闭') : '无 SIM';
    }
    case 'iccid_sim2': {
      const sim = telephony.sims.find((item) => item.slot === 2);
      return sim ? sim.iccid || '未设置' : '无 SIM';
    }
    case 'imei_info_sim2':
      return build.imei2 ?? '未设置';
    case 'signal_strength':
      return '良好';
    case 'service_state':
      return '服务中';
    case 'data_roaming_sim1': {
      const sim = telephony.sims.find((item) => item.slot === 1);
      return sim ? sim.dataRoaming : false;
    }
    case 'data_roaming_sim2': {
      const sim = telephony.sims.find((item) => item.slot === 2);
      return sim ? sim.dataRoaming : false;
    }
    case 'volte_sim1': {
      const sim = telephony.sims.find((item) => item.slot === 1);
      return sim ? sim.voLTE : true;
    }
    case 'volte_sim2': {
      const sim = telephony.sims.find((item) => item.slot === 2);
      return sim ? sim.voLTE : true;
    }
    case 'enabled_5g_sim1': {
      const sim = telephony.sims.find((item) => item.slot === 1);
      return sim ? sim.networkType.includes('5G') : false;
    }
    case 'mobile_data_enable':
      return prefs.mobile_data_enable ?? true;
    case 'wifi_calling_enabled':
      return prefs.wifi_calling_enabled ?? false;
    case 'wifi_calling_mode':
      return prefs.wifi_calling_mode ?? 'wifi_preferred';
    case 'wifi_calling_roaming_mode':
      return prefs.wifi_calling_roaming_mode ?? 'wifi_preferred';
    case 'set_data_warning':
      return prefs.set_data_warning ?? false;
    case 'set_data_limit':
      return prefs.set_data_limit ?? false;
    case 'data_usage_this_cycle':
      return prefs.data_usage_this_cycle ?? '3.8 GB';
    case 'data_usage_remaining':
      return prefs.data_usage_remaining ?? '6.2 GB';
    case 'billing_cycle_date':
      return prefs.billing_cycle_date ?? '每月 1 日';
    case 'data_warning_level':
      return prefs.data_warning_level ?? '2 GB';
    case 'data_limit_level':
      return prefs.data_limit_level ?? '10 GB';
    case 'network_select_mode':
      return prefs.network_select_mode ?? 'auto';
    case 'preferred_network_mode_key':
      return prefs.preferred_network_mode_key ?? '27';
    default: {
      const defaultOpenCategory = getDefaultOpenCategory(normalizedKey);
      if (defaultOpenCategory) {
        return state.settings.secure.defaultOpenHandlers[defaultOpenCategory];
      }
      return prefs[normalizedKey];
    }
  }
}

function genericSetPreference(normalizedKey: string, value: DeviceSettingValue): void {
  switch (normalizedKey) {
    case 'language':
      if (typeof value === 'string') {
        setLocale(value as Locale);
      }
      return;
    case 'nfc_enabled':
      mutateOsState((state) => { state.settings.global.nfcEnabled = Boolean(value); });
      return;
    case 'location_enabled':
      mutateOsState((state) => { state.settings.global.locationEnabled = Boolean(value); });
      return;
    case 'hotspot_ssid':
      mutateOsState((state) => {
        const next = String(value ?? '').trim();
        if (next) state.hardware.hotspot.ssid = next;
      });
      return;
    case 'hotspot_password':
      mutateOsState((state) => {
        const next = String(value ?? '');
        if (next.length >= 8 && next.length <= 63) state.hardware.hotspot.password = next;
      });
      return;
    case 'system_24_hour_format':
      mutateOsState((state) => { state.settings.system.use24HourFormat = Boolean(value); });
      TimeService.setUse24HourFormat(Boolean(value));
      return;
    case 'system_automatic_date_time': {
      const automatic = Boolean(value);
      if (automatic) {
        mutateOsState((state) => { state.settings.system.automaticDateTime = true; });
        activateRealTime();
        return;
      }

      const configured = useOsStateStore.getState().settings.system.manualTime;
      const anchor = typeof configured === 'number' && Number.isFinite(configured)
        ? configured
        : TimeService.now();
      mutateOsState((state) => {
        state.settings.system.automaticDateTime = false;
        state.settings.system.manualTime = anchor;
      });
      activateSimulatedTime(anchor, true);
      return;
    }
    case 'system_time_zone': {
      const timeZone = String(value ?? '').trim();
      if (!VALID_SYSTEM_TIME_ZONES.has(timeZone)) return;
      mutateOsState((state) => { state.settings.system.timeZone = timeZone; });
      TimeService.setSystemTimeZone(timeZone);
      return;
    }
    case 'system_region': {
      const region = String(value ?? '').trim().toUpperCase();
      if (!VALID_SYSTEM_REGIONS.has(region)) return;
      mutateOsState((state) => { state.settings.system.region = region; });
      return;
    }
    case 'system_manual_time': {
      if (useOsStateStore.getState().settings.system.automaticDateTime) return;
      const timestamp = Number(value);
      if (!Number.isFinite(timestamp)) return;
      mutateOsState((state) => { state.settings.system.manualTime = timestamp; });
      activateSimulatedTime(timestamp, true);
      return;
    }
    case 'secure_auto_lock_seconds': {
      const seconds = Math.min(1800, Math.max(5, Math.round(Number(value) || 30)));
      mutateOsState((state) => { state.settings.secure.lockScreen.autoLockSeconds = seconds; });
      return;
    }
    case 'secure_power_button_locks':
      mutateOsState((state) => { state.settings.secure.lockScreen.powerButtonLocks = Boolean(value); });
      return;
    case 'secure_lock_screen_notifications':
      mutateOsState((state) => {
        const enabled = Boolean(value);
        state.settings.secure.lockScreen.notificationsEnabled = enabled;
        if (!enabled) state.settings.secure.lockScreen.showSensitiveNotifications = false;
      });
      return;
    case 'secure_show_sensitive_notifications':
      mutateOsState((state) => {
        state.settings.secure.lockScreen.showSensitiveNotifications =
          state.settings.secure.lockScreen.notificationsEnabled && Boolean(value);
      });
      return;
    case 'secure_fingerprint_enabled':
      mutateOsState((state) => {
        state.settings.secure.lockScreen.fingerprintEnabled =
          state.settings.secure.lockScreen.method === 'pin' && Boolean(value);
      });
      return;
    case 'secure_face_enabled':
      mutateOsState((state) => {
        state.settings.secure.lockScreen.faceEnabled =
          state.settings.secure.lockScreen.method === 'pin' && Boolean(value);
      });
      return;
    case 'secure_find_device_enabled':
      mutateOsState((state) => { state.settings.secure.privacy.findDeviceEnabled = Boolean(value); });
      return;
    case 'secure_app_scanning_enabled':
      mutateOsState((state) => { state.settings.secure.privacy.appScanningEnabled = Boolean(value); });
      return;
    case 'secure_unknown_sources_allowed':
      mutateOsState((state) => { state.settings.secure.privacy.unknownSourcesAllowed = Boolean(value); });
      return;
    case 'secure_camera_access_enabled':
      mutateOsState((state) => { state.settings.secure.privacy.cameraAccessEnabled = Boolean(value); });
      return;
    case 'secure_microphone_access_enabled':
      mutateOsState((state) => { state.settings.secure.privacy.microphoneAccessEnabled = Boolean(value); });
      return;
    case 'secure_clipboard_access_alerts':
      mutateOsState((state) => { state.settings.secure.privacy.clipboardAccessAlertsEnabled = Boolean(value); });
      return;
    case 'secure_sos_enabled':
      mutateOsState((state) => { state.settings.secure.emergency.sosEnabled = Boolean(value); });
      return;
    case 'secure_sos_trigger': {
      const trigger = String(value) as OsSosTrigger;
      if (!VALID_SOS_TRIGGERS.has(trigger)) return;
      mutateOsState((state) => { state.settings.secure.emergency.trigger = trigger; });
      return;
    }
    case 'secure_sos_countdown_sound':
      mutateOsState((state) => { state.settings.secure.emergency.countdownSoundEnabled = Boolean(value); });
      return;
    case 'secure_emergency_location_enabled':
      mutateOsState((state) => { state.settings.secure.emergency.emergencyLocationEnabled = Boolean(value); });
      return;
    case 'secure_wireless_alerts_enabled':
      mutateOsState((state) => { state.settings.secure.emergency.wirelessAlertsEnabled = Boolean(value); });
      return;
    case 'device_system_version':
      setBuildOverrides({ systemVersion: clampString(value, getEffectiveBuildInfo().systemVersion) });
      return;
    case 'firmware_version':
      setBuildOverrides({ androidVersion: clampString(value, getEffectiveBuildInfo().androidVersion) });
      return;
    case 'security_patch':
      setBuildOverrides({ securityPatch: clampString(value, getEffectiveBuildInfo().securityPatch) });
      return;
    case 'model_number':
    case 'hardware_info_device_model':
    case 'device_model':
      setBuildOverrides({ model: clampString(value, getEffectiveBuildInfo().model) });
      return;
    case 'model_name':
      setBuildOverrides({ marketName: clampString(value, getEffectiveBuildInfo().marketName) });
      return;
    case 'device_cpu':
      setBuildOverrides({ processor: clampString(value, getEffectiveBuildInfo().processor) });
      return;
    case 'device_memory':
    case 'key_storage_total_size':
      setBuildOverrides({ ramTotal: clampString(value, getEffectiveBuildInfo().ramTotal) });
      return;
    case 'device_internal_memory':
      setBuildOverrides({ storageTotal: clampString(value, getEffectiveBuildInfo().storageTotal) });
      return;
    case 'device_internal_memory_used':
      mutateOsState((s) => { s.hardware.storage.used = clampString(value, s.hardware.storage.used); });
      return;
    case 'baseband_version':
      setBuildOverrides({ basebandVersion: clampString(value, getEffectiveBuildInfo().basebandVersion) });
      return;
    case 'kernel_version':
      setBuildOverrides({ kernelVersion: clampString(value, getEffectiveBuildInfo().kernelVersion) });
      return;
    case 'hardware_info_device_serial':
      setBuildOverrides({ serialNumber: clampString(value, getEffectiveBuildInfo().serialNumber) });
      return;
    case 'imei_info':
      setBuildOverrides({ imei1: clampString(value, getEffectiveBuildInfo().imei1) });
      return;
    case 'bt_address':
      setBuildOverrides({ bluetoothMac: clampString(value, getEffectiveBuildInfo().bluetoothMac) });
      return;
    case 'wifi_mac_address':
      setBuildOverrides({ macAddress: clampString(value, getEffectiveBuildInfo().macAddress) });
      return;
    case 'software_version':
      setBuildOverrides({ buildNumber: clampString(value, getEffectiveBuildInfo().buildNumber) });
      return;
    case 'slot0_phone_number':
    case 'slot1_phone_number':
    case 'phone_number':
    case 'iccid': {
      const current = getEffectiveTelephony();
      const sims = cloneSims(current.sims);
      const slot = normalizedKey === 'slot1_phone_number'
        ? 2
        : normalizedKey === 'slot0_phone_number'
          ? 1
          : current.defaultDataSim;
      const index = sims.findIndex((sim) => sim.slot === slot);
      const next = index >= 0
        ? { ...sims[index] }
        : {
            slot,
            carrier: '未知运营商',
            phoneNumber: '',
            iccid: '',
            networkType: '4G',
            dataRoaming: false,
            voLTE: true,
          } satisfies SimInfoPreset;
      if (normalizedKey === 'iccid') {
        next.iccid = String(value ?? '').trim();
      } else {
        next.phoneNumber = String(value ?? '').trim();
      }
      if (index >= 0) {
        sims[index] = next;
      } else {
        sims.push(next);
      }
      setTelephonyOverrides({ sims });
      return;
    }
    // --- SIM-slot-specific telephony writes ---
    case 'default_data_sim': {
      const val = Number(value);
      if (val === 1 || val === 2) setTelephonyOverrides({ defaultDataSim: val as 1 | 2 });
      return;
    }
    case 'default_calls_sim': {
      const val = Number(value);
      if (val === 0 || val === 1 || val === 2) setTelephonyOverrides({ defaultCallsSim: val as 1 | 2 | 0 });
      return;
    }
    case 'default_sms_sim': {
      const val = Number(value);
      if (val === 0 || val === 1 || val === 2) setTelephonyOverrides({ defaultSmsSim: val as 1 | 2 | 0 });
      return;
    }
    case 'data_roaming_sim1':
    case 'data_roaming_sim2': {
      const telephony = getEffectiveTelephony();
      const sims = cloneSims(telephony.sims);
      const slot = normalizedKey === 'data_roaming_sim2' ? 2 : 1;
      const idx = sims.findIndex((s) => s.slot === slot);
      if (idx >= 0) {
        sims[idx] = { ...sims[idx], dataRoaming: Boolean(value) };
        setTelephonyOverrides({ sims });
      }
      return;
    }
    case 'volte_sim1':
    case 'volte_sim2': {
      const telephony = getEffectiveTelephony();
      const sims = cloneSims(telephony.sims);
      const slot = normalizedKey === 'volte_sim2' ? 2 : 1;
      const idx = sims.findIndex((s) => s.slot === slot);
      if (idx >= 0) {
        sims[idx] = { ...sims[idx], voLTE: Boolean(value) };
        setTelephonyOverrides({ sims });
      }
      return;
    }
    case 'enabled_5g_sim1': {
      const telephony = getEffectiveTelephony();
      const sims = cloneSims(telephony.sims);
      const idx = sims.findIndex((s) => s.slot === 1);
      if (idx >= 0) {
        sims[idx] = { ...sims[idx], networkType: Boolean(value) ? '5G SA' : '4G' };
        setTelephonyOverrides({ sims });
      }
      return;
    }
    case 'erase_esim_confirmed':
      if (Boolean(value)) {
        mutateOsState((state) => {
          state.preferences['erase_esim_confirmed'] = value;
          state.preferences['esim_travel_profile_present'] = false;
        });
      } else {
        mutateOsState((state) => { state.preferences['erase_esim_confirmed'] = value; });
      }
      return;
    case 'mobile_data_enable':
    case 'wifi_calling_enabled':
    case 'wifi_calling_mode':
    case 'wifi_calling_roaming_mode':
    case 'set_data_warning':
    case 'set_data_limit':
    case 'data_usage_this_cycle':
    case 'data_usage_remaining':
    case 'billing_cycle_date':
    case 'data_warning_level':
    case 'data_limit_level':
    case 'network_select_mode':
    case 'preferred_network_mode_key':
      mutateOsState((state) => { state.preferences[normalizedKey] = value; });
      return;
    default: {
      const defaultOpenCategory = getDefaultOpenCategory(normalizedKey);
      if (!defaultOpenCategory) return;
      const appId = value == null ? null : String(value).trim();
      if (appId === '') return;
      mutateOsState((state) => {
        state.settings.secure.defaultOpenHandlers[defaultOpenCategory] = appId;
      });
      return;
    }
  }
}

export function routeGetPreference(key: string): DeviceSettingValue | undefined {
  const normalized = normalizePreferenceKey(key);
  if (!normalized) return undefined;
  const manager = keyToManager.get(normalized);
  if (manager) {
    const value = manager.getPreference(normalized);
    if (value !== undefined) return value;
  }
  return genericGetPreference(normalized);
}

export function routeSetPreference(
  key: string,
  value: DeviceSettingValue,
  options?: DeviceSetOptions,
): void {
  const normalized = normalizePreferenceKey(key);
  if (!normalized) return;
  mutateOsState((state) => {
    const current = state.preferences[normalized];
    if (current === value) return;
    state.preferences[normalized] = value;
  });
  const manager = keyToManager.get(normalized);
  if (manager) {
    manager.setPreference(normalized, value, options);
    return;
  }
  genericSetPreference(normalized, value);
}

TimeService.setUse24HourFormat(useOsStateStore.getState().settings.system.use24HourFormat);
TimeService.setSystemTimeZone(useOsStateStore.getState().settings.system.timeZone);

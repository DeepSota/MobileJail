import type { PermissionStatus } from './permissions';
import { OS_DEFAULTS } from './data';
import type {
  BluetoothDevicePreset,
  DeviceBatteryExtraPreset,
  DeviceSettingsPreset,
  SimInfoPreset,
  WifiAccessPointPreset,
} from './data/types';
import { createOsStore } from './createOsStore';

export interface OsSystemSettings extends DeviceSettingsPreset {
  /** System clock and locale preferences used by Settings and TimeService. */
  use24HourFormat: boolean;
  automaticDateTime: boolean;
  timeZone: string;
  region: string;
  /** Last manually selected clock anchor. Kept when automatic time is re-enabled. */
  manualTime: number | null;
}

export const OS_SUPPORTED_TIME_ZONES = [
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Europe/London',
  'America/Los_Angeles',
] as const;

export const OS_SUPPORTED_REGIONS = ['CN', 'US', 'GB', 'JP', 'SG'] as const;

export interface OsGlobalSettings {
  wifiEnabled: boolean;
  mobileDataEnabled: boolean;
  bluetoothEnabled: boolean;
  airplaneModeEnabled: boolean;
  doNotDisturbEnabled: boolean;
  silentMode: boolean;
  flashlightEnabled: boolean;
  batterySaverEnabled: boolean;
  rotationLocked: boolean;
  locationEnabled: boolean;
  nfcEnabled: boolean;
  screenCastEnabled: boolean;
  autoBrightnessEnabled: boolean;
  eyeComfortEnabled: boolean;
  darkModeEnabled: boolean;
  language: string;
}

export type OsLockScreenMethod = 'none' | 'pin';
export type OsSosTrigger = 'power_button_5' | 'power_button_3' | 'hold_power_volume';
export type OsDefaultOpenCategory = 'pdf' | 'image' | 'document';

export interface OsPinCredential {
  algorithm: 'SHA-256';
  salt: string;
  hash: string;
  changedAt: number;
}

/**
 * Security-sensitive device settings.
 *
 * This domain intentionally lives outside the free-form `preferences` bag so
 * callers cannot mistake UI-only values for enforced device security state.
 * PIN material is represented only by a salted one-way digest.
 */
export interface OsSecureSettings {
  /** User-selected ACTION_VIEW defaults. IntentResolver validates capabilities at use time. */
  defaultOpenHandlers: Record<OsDefaultOpenCategory, string | null>;
  lockScreen: {
    method: OsLockScreenMethod;
    credential: OsPinCredential | null;
    autoLockSeconds: number;
    powerButtonLocks: boolean;
    notificationsEnabled: boolean;
    showSensitiveNotifications: boolean;
    fingerprintEnabled: boolean;
    faceEnabled: boolean;
  };
  privacy: {
    findDeviceEnabled: boolean;
    appScanningEnabled: boolean;
    unknownSourcesAllowed: boolean;
    cameraAccessEnabled: boolean;
    microphoneAccessEnabled: boolean;
    clipboardAccessAlertsEnabled: boolean;
  };
  emergency: {
    sosEnabled: boolean;
    trigger: OsSosTrigger;
    countdownSoundEnabled: boolean;
    emergencyLocationEnabled: boolean;
    wirelessAlertsEnabled: boolean;
  };
}

export interface OsBatteryState extends DeviceBatteryExtraPreset {
  percent: number;
  charging: boolean;
  fastCharging: boolean;
}

export interface OsCellularState {
  signalLevel: number;
  mobileDataType: string;
  noSim: boolean;
}

export interface OsWifiState {
  level: number;
  connectedSsid?: string;
  ipAddress?: string;
  macAddress?: string;
  linkSpeed?: number;
  frequency?: number;
}

export interface OsBluetoothState {
  name: string;
}

export interface OsStorageState {
  used: string;
}

export interface OsHotspotState {
  enabled: boolean;
  ssid: string;
  password: string;
}

export interface OsHardwareState {
  battery: OsBatteryState;
  cellular: OsCellularState;
  wifi: OsWifiState;
  bluetooth: OsBluetoothState;
  storage: OsStorageState;
  hotspot: OsHotspotState;
  vpnEnabled: boolean;
  headsetConnected: boolean;
  alarmSet: boolean;
  nearbyWifi: WifiAccessPointPreset[];
  nearbyBluetooth: BluetoothDevicePreset[];
}

export interface OsTelephonyState {
  sims: SimInfoPreset[];
  defaultDataSim: 1 | 2;
}

export interface OsState {
  settings: {
    system: OsSystemSettings;
    global: OsGlobalSettings;
    secure: OsSecureSettings;
  };
  hardware: OsHardwareState;
  permissions: Record<string, Record<string, PermissionStatus>>;
  preferences: Record<string, string | number | boolean | null>;
}

function createDefaultSecureSettings(): OsSecureSettings {
  return {
    defaultOpenHandlers: {
      pdf: 'file_manager',
      image: 'gallery',
      document: 'file_manager',
    },
    lockScreen: {
      method: 'none',
      credential: null,
      autoLockSeconds: 30,
      powerButtonLocks: true,
      notificationsEnabled: true,
      showSensitiveNotifications: false,
      fingerprintEnabled: false,
      faceEnabled: false,
    },
    privacy: {
      findDeviceEnabled: true,
      appScanningEnabled: true,
      unknownSourcesAllowed: false,
      cameraAccessEnabled: true,
      microphoneAccessEnabled: true,
      clipboardAccessAlertsEnabled: true,
    },
    emergency: {
      sosEnabled: false,
      trigger: 'power_button_5',
      countdownSoundEnabled: true,
      emergencyLocationEnabled: true,
      wirelessAlertsEnabled: true,
    },
  };
}

function createDefaultOsState(): OsState {
  return {
    settings: {
      system: {
        ...structuredClone(OS_DEFAULTS.settings.system),
        use24HourFormat: true,
        automaticDateTime: true,
        timeZone: 'Asia/Shanghai',
        region: 'CN',
        manualTime: null,
      } as OsSystemSettings,
      global: structuredClone(OS_DEFAULTS.settings.global) as OsGlobalSettings,
      secure: createDefaultSecureSettings(),
    },
    hardware: structuredClone(OS_DEFAULTS.hardware) as OsHardwareState,
    permissions: {},
    preferences: structuredClone(OS_DEFAULTS.preferences) as Record<string, string | number | boolean | null>,
  };
}

function validateOsState(raw: unknown, defaults: OsState): OsState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return structuredClone(defaults);
  const value = raw as Partial<OsState>;
  const settings = value.settings as Partial<OsState['settings']> | undefined;
  const secure = settings?.secure as Partial<OsSecureSettings> | undefined;
  const defaultSecure = defaults.settings.secure;
  const rawSystem = settings?.system as Partial<OsSystemSettings> | undefined;
  const mergedSystem = { ...defaults.settings.system, ...(rawSystem || {}) };
  const validTimeZones = new Set<string>(OS_SUPPORTED_TIME_ZONES);
  const validRegions = new Set<string>(OS_SUPPORTED_REGIONS);
  const rawDefaultHandlers = secure?.defaultOpenHandlers;
  const normalizeDefaultHandler = (
    category: OsDefaultOpenCategory,
  ): string | null => {
    const candidate = rawDefaultHandlers?.[category];
    if (candidate === null) return null;
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    return defaultSecure.defaultOpenHandlers[category];
  };

  return {
    ...structuredClone(defaults),
    ...value,
    settings: {
      ...defaults.settings,
      ...settings,
      system: {
        ...mergedSystem,
        use24HourFormat: typeof rawSystem?.use24HourFormat === 'boolean'
          ? rawSystem.use24HourFormat
          : defaults.settings.system.use24HourFormat,
        automaticDateTime: typeof rawSystem?.automaticDateTime === 'boolean'
          ? rawSystem.automaticDateTime
          : defaults.settings.system.automaticDateTime,
        timeZone: validTimeZones.has(String(rawSystem?.timeZone || ''))
          ? String(rawSystem?.timeZone)
          : defaults.settings.system.timeZone,
        region: validRegions.has(String(rawSystem?.region || '').toUpperCase())
          ? String(rawSystem?.region).toUpperCase()
          : defaults.settings.system.region,
        manualTime: rawSystem?.manualTime === null || (
          typeof rawSystem?.manualTime === 'number' && Number.isFinite(rawSystem.manualTime)
        )
          ? rawSystem.manualTime
          : defaults.settings.system.manualTime,
      },
      global: { ...defaults.settings.global, ...(settings?.global || {}) },
      secure: {
        ...defaultSecure,
        ...secure,
        defaultOpenHandlers: {
          pdf: normalizeDefaultHandler('pdf'),
          image: normalizeDefaultHandler('image'),
          document: normalizeDefaultHandler('document'),
        },
        lockScreen: { ...defaultSecure.lockScreen, ...(secure?.lockScreen || {}) },
        privacy: { ...defaultSecure.privacy, ...(secure?.privacy || {}) },
        emergency: { ...defaultSecure.emergency, ...(secure?.emergency || {}) },
      },
    },
    hardware: value.hardware || structuredClone(defaults.hardware),
    permissions: value.permissions || {},
    preferences: value.preferences || {},
  };
}

export const defaultOsState = createDefaultOsState();

export const useOsStateStore = createOsStore<OsState>(
  'osState',
  defaultOsState,
  {
    persistName: 'os_state',
    registerToServiceRegistry: false,
    validate: validateOsState,
  },
);

export const OsStateStore = {
  getState: useOsStateStore.getState,
  setState: useOsStateStore.setState,
  subscribe: useOsStateStore.subscribe,
  reset: () => useOsStateStore.setState(createDefaultOsState(), true),
};

export function mutateOsState(recipe: (state: OsState) => void): void {
  (useOsStateStore.setState as any)(recipe);
}

export const OS_TELEPHONY_DEFAULTS = OS_DEFAULTS.telephony as OsTelephonyState;

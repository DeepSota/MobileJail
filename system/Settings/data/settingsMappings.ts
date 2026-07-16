/**
 * Settings-only compatibility aliases.
 *
 * The extracted Android resources contain vendor/AOSP key and Fragment names
 * that do not always match the simulator's canonical preference keys/page ids.
 * Keep those translations here instead of teaching OS managers about UI-layer
 * resource names.
 */
const SETTINGS_PREFERENCE_KEY_ALIASES: Record<string, string> = {
  airplane_mode_on: 'airplane_mode',
  toggle_airplane: 'airplane_mode',
  main_toggle_wifi: 'wifi_enable',
  wifi_tether: 'wifi_hotspot_enable',
  dark_ui_mode_accessibility: 'dark_ui_mode',
  vpn_enable: 'vpn_enabled',
  toggle_nfc: 'nfc_enabled',
  multiple_positioning_mode: 'location_enabled',
};

const SETTINGS_PAGE_ID_ALIASES: Record<string, string> = {
  PowerUsageSummary: 'power_usage_summary_screen',
  ManageApplications: 'applications_settings',
  ApplicationsContainer: 'applications_settings',
  NotificationAppListSettings: 'notification_managing',
  PermissonManagerContainer: 'permission_managing',
  MiuiLocaleSettings: 'locale_picker',
  AccountDashboardFragment: 'manage_accounts_settings_miui',
  EnterprisePrivacySettings: 'enterprise_privacy_settings',
  MiuiDeviceNameEditFragment: 'my_device_settings',
};

export function resolveSettingsPreferenceKey(key: string): string {
  return SETTINGS_PREFERENCE_KEY_ALIASES[key] || key;
}

export function resolveSettingsPageId(pageId: string): string {
  return SETTINGS_PAGE_ID_ALIASES[pageId] || pageId;
}

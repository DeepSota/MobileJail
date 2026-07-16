import React from 'react';
import { useOsStateStore } from '../../../os/OsStateStore';
import { strings } from '../res/strings';
import { stringsEn } from '../res/strings.en';
import { useAppStrings } from '@/os/useAppStrings';
import { ListPreference } from './ListPreference';
import { PreferenceCategory } from './PreferenceCategory';
import { SettingsHeader } from './SettingsHeader';
import { SwitchPreference } from './SwitchPreference';

export const SafetyEmergencyPage: React.FC = () => {
  const s = useAppStrings(strings, stringsEn);
  const emergency = useOsStateStore((state) => state.settings.secure.emergency);

  return (
    <div className="flex h-full flex-col bg-app-bg">
      <SettingsHeader title={s.safety_emergency_center} />
      <div
        className="no-scrollbar flex-1 overflow-y-auto pb-8"
        data-scroll-container="main"
        data-scroll-direction="vertical"
      >
        <div className="mx-4 mt-2 rounded-2xl border border-red-100 bg-gradient-to-br from-red-50 to-orange-50 p-4">
          <div className="text-[12px] font-medium uppercase tracking-wide text-red-500">
            {s.emergency_status}
          </div>
          <div className="mt-1 text-[16px] font-semibold text-app-text">
            {emergency.sosEnabled ? s.emergency_features_ready : s.emergency_features_off}
          </div>
        </div>

        <PreferenceCategory title={s.emergency_sos_3}>
          <SwitchPreference
            title={s.emergency_sos_switch}
            summary={s.emergency_sos_switch_summary}
            settingKey="secure_sos_enabled"
            showDivider={true}
          />
          <ListPreference
            title={s.sos_trigger_method}
            settingKey="secure_sos_trigger"
            defaultValue="power_button_5"
            options={[
              { label: s.press_power_5_times, value: 'power_button_5' },
              { label: s.press_power_3_times, value: 'power_button_3' },
              { label: s.hold_power_and_volume, value: 'hold_power_volume' },
            ]}
            showDivider={true}
          />
          <SwitchPreference
            title={s.play_sos_countdown_sound}
            settingKey="secure_sos_countdown_sound"
            defaultChecked={true}
            showDivider={false}
          />
        </PreferenceCategory>

        <PreferenceCategory title={s.emergency_services}>
          <SwitchPreference
            title={s.emergency_location_service}
            summary={s.emergency_location_service_summary}
            settingKey="secure_emergency_location_enabled"
            defaultChecked={true}
            showDivider={true}
          />
          <SwitchPreference
            title={s.wireless_emergency_alerts_switch}
            summary={s.wireless_emergency_alerts_summary}
            settingKey="secure_wireless_alerts_enabled"
            defaultChecked={true}
            showDivider={false}
          />
        </PreferenceCategory>

      </div>
    </div>
  );
};

export default SafetyEmergencyPage;

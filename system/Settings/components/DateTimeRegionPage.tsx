import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Toast } from '@/os/components/Toast';
import * as TimeService from '../../../os/TimeService';
import {
  useRealTime as activateRealTime,
  useSimulatedTime as activateSimulatedTime,
} from '../../../os/TimeService';
import {
  routeSetPreference,
  SYSTEM_REGIONS,
  SYSTEM_TIME_ZONES,
} from '../../../os/managers/registry';
import { useOsStateStore } from '../../../os/OsStateStore';
import { strings } from '../res/strings';
import { stringsEn } from '../res/strings.en';
import { useAppStrings } from '@/os/useAppStrings';
import { useSettingsDialog } from '../hooks/useSettingsDialog';
import { InputDialog } from './InputDialog';
import { ListPreference } from './ListPreference';
import { PreferenceCategory } from './PreferenceCategory';
import { PreferenceItem } from './PreferenceItem';
import { SettingsHeader } from './SettingsHeader';
import { SwitchPreference } from './SwitchPreference';

const REGION_LOCALES: Record<(typeof SYSTEM_REGIONS)[number], string> = {
  CN: 'zh-CN',
  US: 'en-US',
  GB: 'en-GB',
  JP: 'ja-JP',
  SG: 'en-SG',
};

function dateParts(timestamp: number, timeZone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const entries = formatter.formatToParts(TimeService.fromTimestamp(timestamp))
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]);
  return Object.fromEntries(entries);
}

export function toZonedDateTimeInput(timestamp: number, timeZone: string): string {
  const parts = dateParts(timestamp, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Convert a datetime-local wall clock value in the selected IANA zone into an epoch. */
export function parseZonedDateTimeInput(value: string, timeZone: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, rawYear, rawMonth, rawDay, rawHour, rawMinute] = match;
  const year = Number(rawYear);
  const month = Number(rawMonth);
  const day = Number(rawDay);
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  const wallClockUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  if (!Number.isFinite(wallClockUtc)) return null;

  let candidate = wallClockUtc;
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = dateParts(candidate, timeZone);
    const representedUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
      0,
    );
    candidate = wallClockUtc - (representedUtc - candidate);
  }

  const roundTrip = toZonedDateTimeInput(candidate, timeZone);
  return roundTrip === value.trim() ? candidate : null;
}

function formatSystemDateTime(
  timestamp: number,
  timeZone: string,
  region: string,
  use24HourFormat: boolean,
): string {
  const locale = REGION_LOCALES[region as keyof typeof REGION_LOCALES] || 'zh-CN';
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: !use24HourFormat,
  }).format(TimeService.fromTimestamp(timestamp));
}

export const DateTimeRegionPage: React.FC = () => {
  const s = useAppStrings(strings, stringsEn);
  const system = useOsStateStore((state) => state.settings.system);
  const manualDialog = useSettingsDialog('value', 'manualDateTime');
  const toastTimerRef = useRef<number | undefined>(undefined);
  const [clockRevision, setClockRevision] = useState(0);
  const [toast, setToast] = useState({ visible: false, message: '' });

  const showToast = (message: string) => {
    setToast({ visible: true, message });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast((previous) => ({ ...previous, visible: false }));
    }, 1800);
  };

  useEffect(() => {
    if (system.automaticDateTime) {
      if (TimeService.getTimeConfig().mode !== 'real') activateRealTime();
      return;
    }

    if (typeof system.manualTime === 'number' && Number.isFinite(system.manualTime)) {
      const config = TimeService.getTimeConfig();
      if (
        config.mode !== 'simulated' ||
        Number(config.simulatedTime) !== system.manualTime ||
        config.flowing === false
      ) {
        activateSimulatedTime(system.manualTime, true);
      }
      return;
    }
    routeSetPreference('system_manual_time', TimeService.now(), { source: 'settings' });
  }, [system.automaticDateTime, system.manualTime]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockRevision((value) => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
  }, []);

  const now = TimeService.now();
  void clockRevision;
  const currentDateTime = formatSystemDateTime(
    now,
    system.timeZone,
    system.region,
    system.use24HourFormat,
  );
  const manualInputValue = toZonedDateTimeInput(now, system.timeZone);

  const timeZoneOptions = useMemo(() => [
    { value: SYSTEM_TIME_ZONES[0], label: s.time_zone_shanghai },
    { value: SYSTEM_TIME_ZONES[1], label: s.time_zone_tokyo },
    { value: SYSTEM_TIME_ZONES[2], label: s.time_zone_singapore },
    { value: SYSTEM_TIME_ZONES[3], label: s.time_zone_london },
    { value: SYSTEM_TIME_ZONES[4], label: s.time_zone_los_angeles },
  ], [s]);

  const regionOptions = useMemo(() => [
    { value: SYSTEM_REGIONS[0], label: s.region_china },
    { value: SYSTEM_REGIONS[1], label: s.region_united_states },
    { value: SYSTEM_REGIONS[2], label: s.region_united_kingdom },
    { value: SYSTEM_REGIONS[3], label: s.region_japan },
    { value: SYSTEM_REGIONS[4], label: s.region_singapore },
  ], [s]);

  const handleManualTime = (value: string) => {
    if (system.automaticDateTime) return;
    const timestamp = parseZonedDateTimeInput(value, system.timeZone);
    if (timestamp === null) {
      showToast(s.invalid_date_and_time);
      return;
    }
    routeSetPreference('system_manual_time', timestamp, { source: 'settings' });
    manualDialog.close();
    showToast(s.date_and_time_updated);
  };

  return (
    <div className="flex h-full flex-col bg-app-bg">
      <SettingsHeader title={s.date_and_time_region} />
      <div
        className="no-scrollbar flex-1 overflow-y-auto pb-8"
        data-scroll-container="main"
        data-scroll-direction="vertical"
      >
        <div className="mx-4 mt-2 rounded-2xl bg-gradient-to-br from-sky-500 to-blue-700 p-4 text-white shadow-sm">
          <div className="text-[12px] text-white/75">{s.system_date_and_time}</div>
          <div className="mt-1 text-[18px] font-semibold leading-snug">{currentDateTime}</div>
          <div className="mt-1 text-[11px] text-white/70">{system.timeZone}</div>
        </div>

        <PreferenceCategory title={s.time_display}>
          <SwitchPreference
            title={s.use_24_hour_format}
            summary={system.use24HourFormat ? s.twenty_four_hour_example : s.twelve_hour_example}
            settingKey="system_24_hour_format"
            defaultChecked={true}
            showDivider={false}
          />
        </PreferenceCategory>

        <PreferenceCategory title={s.day_and_time}>
          <SwitchPreference
            title={s.automatic_date_and_time}
            summary={s.use_network_provided_time}
            settingKey="system_automatic_date_time"
            defaultChecked={true}
            showDivider={true}
          />
          <div className={system.automaticDateTime ? 'opacity-45' : undefined}>
            <PreferenceItem
              title={s.set_date_and_time}
              summary={system.automaticDateTime ? s.turn_off_automatic_time_first : currentDateTime}
              value={system.automaticDateTime ? s.automatic : undefined}
              showDivider={false}
              itemProps={system.automaticDateTime
                ? { 'aria-disabled': true }
                : manualDialog.bindOpen<HTMLDivElement>()}
            />
          </div>
        </PreferenceCategory>

        <PreferenceCategory title={s.time_zone}>
          <ListPreference
            title={s.select_time_zone}
            summary={s.time_zone_changes_displayed_time}
            settingKey="system_time_zone"
            defaultValue="Asia/Shanghai"
            options={timeZoneOptions}
            showDivider={false}
          />
        </PreferenceCategory>

        <PreferenceCategory title={s.region}>
          <ListPreference
            title={s.select_region}
            summary={s.region_changes_formats}
            settingKey="system_region"
            defaultValue="CN"
            options={regionOptions}
            showDivider={false}
          />
        </PreferenceCategory>
      </div>

      <InputDialog
        open={manualDialog.isOpen && !system.automaticDateTime}
        title={s.set_date_and_time}
        defaultValue={manualInputValue}
        inputType="datetime-local"
        onClose={manualDialog.close}
        onConfirm={handleManualTime}
        confirmAction={{
          id: 'settings.datetime.manual.submit',
          params: (value) => ({ value }),
        }}
      />
      <Toast message={toast.message} visible={toast.visible} />
    </div>
  );
};

export default DateTimeRegionPage;

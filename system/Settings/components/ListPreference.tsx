import React, { useMemo, useRef } from 'react';
import { PreferenceItem } from './PreferenceItem';
import { useStringPreference } from '../state';
import { strings } from '../res/strings';
import { stringsEn } from '../res/strings.en';
import { useAppStrings } from '@/os/useAppStrings';
import { useSettingsGestures } from '../hooks/useSettingsGestures';
import { useSettingsDialog } from '../hooks/useSettingsDialog';

export const ListPreference: React.FC<{
  title: string;
  summary?: string;
  options?: Array<{ label: string; value: string }>;
  defaultValue?: string;
  settingKey: string;
  showDivider?: boolean;
  onMissingOptions?: () => void;
  disabled?: boolean;
}> = ({
  title,
  summary,
  options = [],
  defaultValue,
  settingKey,
  showDivider = true,
  onMissingOptions,
  disabled = false,
}) => {
  const s = useAppStrings(strings, stringsEn);
  const { bindTap } = useSettingsGestures();
  const dialog = useSettingsDialog('list', settingKey);

  const [value, setValue] = useStringPreference(
    settingKey,
    defaultValue ?? (options[0]?.value ?? '')
  );

  const selectedLabel = useMemo(() => {
    const found = options.find((o) => o.value === value);
    return found?.label || '';
  }, [options, value]);

  const sheetRef = useRef<HTMLDivElement | null>(null);

  return (
    <>
      <PreferenceItem
        title={title}
        summary={summary}
        value={selectedLabel || undefined}
        showChevron={!disabled}
        showDivider={showDivider}
        itemProps={!disabled && options.length ? dialog.bindOpen<HTMLDivElement>() : undefined}
        onClick={!disabled && options.length === 0 ? onMissingOptions : undefined}
      />

      {dialog.isOpen && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center px-3 pb-3">
          <div
            className="absolute inset-0 bg-black/40"
            data-trigger="system.back"
            data-trigger-type="back"
            onClick={dialog.close}
          />
          <div
            ref={sheetRef}
            tabIndex={-1}
            className="relative w-full max-w-[420px] bg-app-surface rounded-[28px] overflow-hidden shadow-2xl outline-none"
          >
            <div className="px-6 pt-6 pb-2 text-center">
              <div className="text-[17px] font-semibold text-app-text">{title}</div>
              {summary && (
                <div className="mt-1 text-[12px] text-gray-400 leading-snug line-clamp-2">
                  {summary}
                </div>
              )}
            </div>
            <div
              className="max-h-[55vh] overflow-y-auto no-scrollbar"
              data-scroll-container="options"
              data-scroll-direction="vertical"
            >
              {options.map((opt) => {
                const selected = opt.value === value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    className="w-full px-6 py-4 text-left text-[16px] active:bg-gray-50 flex items-center justify-between"
                    {...bindTap<HTMLButtonElement>(
                      { kind: 'action', id: 'settings.preference.option.select.value' },
                      {
                        params: { key: settingKey, value: opt.value },
                        onTrigger: () => {
                          setValue(opt.value);
                          dialog.close();
                        },
                      },
                    )}
                  >
                    <span className={selected ? 'text-app-primary font-medium' : 'text-app-text'}>
                      {opt.label}
                    </span>
                    {selected && (
                      <span className="text-app-primary text-[14px] font-medium">{s.selected}</span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="px-6 pb-6 pt-2">
              <button
                type="button"
                className="w-full py-3 rounded-2xl bg-gray-50 text-[16px] font-medium text-app-text active:bg-gray-100"
                data-trigger="system.back"
                data-trigger-type="back"
                onClick={dialog.close}
              >
                {s.cancel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

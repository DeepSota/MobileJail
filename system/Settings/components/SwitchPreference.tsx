import React from 'react';
import { useBooleanPreference } from '../state';
import { useSettingsGestures } from '../hooks/useSettingsGestures';

interface SwitchPreferenceProps {
  title: string;
  summary?: string;
  defaultChecked?: boolean;
  /** Key into settingsConfig preferences */
  settingKey: string;
  showDivider?: boolean;
  disabled?: boolean;
}

/** A preference item with a toggle switch */
export const SwitchPreference: React.FC<SwitchPreferenceProps> = ({
  title,
  summary,
  defaultChecked = false,
  settingKey,
  showDivider = true,
  disabled = false,
}) => {
  const [checked, setChecked] = useBooleanPreference(settingKey, defaultChecked);
  const { bindTap } = useSettingsGestures();

  return (
    <div>
      <div
        className={`flex items-center px-4 py-3.5 min-h-(--app-preference-item-min-height) ${
          disabled ? 'opacity-45' : 'active:bg-gray-50'
        }`}
        aria-disabled={disabled}
        {...(disabled
          ? {}
          : bindTap<HTMLDivElement>(
              { kind: 'action', id: 'settings.preference.toggle' },
              {
                params: { key: settingKey, to: !checked },
                onTrigger: () => setChecked(!checked),
              },
            ))}
      >
        <div className="flex-1 min-w-0">
          <div className="text-[15px] text-app-text leading-tight">{title}</div>
          {summary && (
            <div className="text-[12px] text-gray-400 mt-0.5 leading-tight line-clamp-2">
              {summary}
            </div>
          )}
        </div>
        <div className="ml-3 flex-shrink-0">
          <div
            className={`w-(--app-switch-track-width) h-(--app-switch-track-height) rounded-full flex items-center p-(--app-switch-track-padding) transition-colors ${
              checked && !disabled ? 'bg-app-primary justify-end' : 'bg-gray-300 justify-start'
            }`}
            style={{ transitionDuration: 'var(--app-duration-short)' }}
          >
            <div className="w-(--app-switch-thumb-size) h-(--app-switch-thumb-size) bg-app-surface rounded-full shadow-sm" />
          </div>
        </div>
      </div>
      {showDivider && <div className="h-px bg-gray-100 ml-4 mr-4" />}
    </div>
  );
};

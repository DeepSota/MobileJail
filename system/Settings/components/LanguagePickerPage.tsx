import React, { useSyncExternalStore } from 'react';
import { IcCheck } from '../res/icons';
import { SettingsHeader } from './SettingsHeader';
import { PreferenceCategory } from './PreferenceCategory';
import { PreferenceItem } from './PreferenceItem';
import { getLocale, setLocale, subscribeLocale } from '../../../os/locale';
import { strings } from '../res/strings';
import { stringsEn } from '../res/strings.en';
import { useAppStrings } from '@/os/useAppStrings';
import { useSettingsGestures } from '../hooks/useSettingsGestures';
const DEFAULT_LANGUAGE = 'zh-Hans';

export const LanguagePickerPage: React.FC = () => {
  const s = useAppStrings(strings, stringsEn);
  const { bindTap } = useSettingsGestures();

  const LANGUAGE_OPTIONS = [
    { value: 'zh-Hans', title: s.chinese_simplified },
    { value: 'en', title: 'English' },
  ] as const;
  const currentLanguage = useSyncExternalStore(
    subscribeLocale,
    () => getLocale() || DEFAULT_LANGUAGE,
  );

  const setLanguage = (value: 'zh-Hans' | 'en') => {
    setLocale(value);
  };

  return (
    <div className="h-full bg-app-bg flex flex-col">
      <SettingsHeader title={s.language} />
      <div
        className="flex-1 overflow-y-auto no-scrollbar pb-8"
        data-scroll-container="main"
        data-scroll-direction="vertical"
      >
        <PreferenceCategory>
          {LANGUAGE_OPTIONS.map((opt, idx) => {
            const selected = opt.value === currentLanguage;
            return (
              <PreferenceItem
                key={opt.value}
                title={opt.title}
                showChevron={false}
                showDivider={idx < LANGUAGE_OPTIONS.length - 1}
                itemProps={bindTap<HTMLDivElement>(
                  { kind: 'action', id: 'settings.language.option.select.value' },
                  {
                    params: { language: opt.value },
                    onTrigger: () => setLanguage(opt.value),
                  },
                )}
              >
                {selected ? <IcCheck size={18} className="text-app-primary" /> : null}
              </PreferenceItem>
            );
          })}
        </PreferenceCategory>
      </div>
    </div>
  );
};

export default LanguagePickerPage;

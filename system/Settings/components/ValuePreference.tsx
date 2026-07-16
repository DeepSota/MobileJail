import React, { useMemo } from 'react';
import { PreferenceItem } from './PreferenceItem';
import { InputDialog } from './InputDialog';
import { useStringPreference } from '../state';
import { strings } from '../res/strings';
import { stringsEn } from '../res/strings.en';
import { useAppStrings } from '@/os/useAppStrings';
import { useSettingsDialog } from '../hooks/useSettingsDialog';

function androidInputTypeToHtmlType(
  androidInputType: string | undefined,
  settingKey: string
): React.HTMLInputTypeAttribute {
  const t = (androidInputType || '').toLowerCase();
  if (t.includes('password')) return 'password';
  if (t.includes('email')) return 'email';
  if (t.includes('uri') || t.includes('url')) return 'url';
  if (t.includes('phone')) return 'tel';
  if (t.includes('number')) return 'number';

  // Heuristic fallback by key name
  const k = settingKey.toLowerCase();
  if (k.includes('password') || k.includes('passwd') || k.endsWith('_pwd') || k.includes('pin')) return 'password';
  if (k.includes('port') || k.endsWith('_mcc') || k.endsWith('_mnc')) return 'number';
  return 'text';
}

export const ValuePreference: React.FC<{
  title: string;
  summary?: string;
  settingKey: string;
  defaultValue?: string;
  inputType?: string;
  showDivider?: boolean;
  /** If provided, clicking will navigate instead of editing */
  onNavigate?: () => void;
  itemProps?: React.HTMLAttributes<HTMLDivElement>;
}> = ({
  title,
  summary,
  settingKey,
  defaultValue = '',
  inputType,
  showDivider = true,
  onNavigate,
  itemProps,
}) => {
  const s = useAppStrings(strings, stringsEn);
  const [value, setValue] = useStringPreference(settingKey, defaultValue);
  const dialog = useSettingsDialog('value', settingKey);

  const htmlInputType = useMemo(
    () => androidInputTypeToHtmlType(inputType, settingKey),
    [inputType, settingKey]
  );
  const displayValue = htmlInputType === 'password'
    ? (value ? s.set : '')
    : value;

  return (
    <>
      <PreferenceItem
        title={title}
        summary={summary}
        value={displayValue || undefined}
        showChevron={!!onNavigate}
        showDivider={showDivider}
        itemProps={onNavigate ? itemProps : dialog.bindOpen<HTMLDivElement>()}
      />
      <InputDialog
        open={dialog.isOpen}
        title={title}
        defaultValue={value}
        placeholder={s.enter_value}
        inputType={htmlInputType}
        onClose={dialog.close}
        confirmAction={{
          id: 'settings.preference.value.submit',
          params: (nextValue) => ({ key: settingKey, value: nextValue }),
        }}
        onConfirm={(v) => {
          setValue(v);
          dialog.close();
        }}
      />
    </>
  );
};

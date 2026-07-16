import React, { useEffect, useRef, useState } from 'react';
import { Toast } from '@/os/components/Toast';
import { useOsStateStore } from '../../../os/OsStateStore';
import {
  changeSecurePin,
  clearSecurePin,
  isValidSecurePin,
  setSecurePin,
  verifySecurePin,
} from '../../../os/managers/registry';
import { strings } from '../res/strings';
import { stringsEn } from '../res/strings.en';
import { useAppStrings } from '@/os/useAppStrings';
import { useSettingsDialog } from '../hooks/useSettingsDialog';
import { useSettingsGestures } from '../hooks/useSettingsGestures';
import { IcLock } from '../res/icons';
import { InputDialog } from './InputDialog';
import { ListPreference } from './ListPreference';
import { PreferenceCategory } from './PreferenceCategory';
import { PreferenceItem } from './PreferenceItem';
import { SettingsHeader } from './SettingsHeader';
import { SwitchPreference } from './SwitchPreference';

type PinStage =
  | 'setupNew'
  | 'setupConfirm'
  | 'changeVerify'
  | 'changeNew'
  | 'changeConfirm'
  | 'clearVerify';

const PIN_STAGES = new Set<PinStage>([
  'setupNew',
  'setupConfirm',
  'changeVerify',
  'changeNew',
  'changeConfirm',
  'clearVerify',
]);

export const SecurityPrivacyPage: React.FC = () => {
  const s = useAppStrings(strings, stringsEn);
  const { bindTap, go } = useSettingsGestures();
  const pinDialog = useSettingsDialog('value');
  const secure = useOsStateStore((state) => state.settings.secure);
  const hasPin = secure.lockScreen.method === 'pin' && !!secure.lockScreen.credential;
  const pendingPinRef = useRef('');
  const currentPinRef = useRef('');
  const busyRef = useRef(false);
  const toastTimerRef = useRef<number | undefined>(undefined);
  const [toast, setToast] = useState({ visible: false, message: '' });

  const showToast = (message: string) => {
    setToast({ visible: true, message });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast((previous) => ({ ...previous, visible: false }));
    }, 1800);
  };

  useEffect(() => () => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    pendingPinRef.current = '';
    currentPinRef.current = '';
  }, []);

  const rawStage = pinDialog.activeDialogKey as PinStage;
  const stage = PIN_STAGES.has(rawStage) ? rawStage : 'setupNew';

  const moveToStage = (nextStage: PinStage) => {
    go('security.pin.step', {
      pageId: 'security_privacy_settings',
      dialogKey: nextStage,
    });
  };

  const closePinDialog = () => {
    pendingPinRef.current = '';
    currentPinRef.current = '';
    pinDialog.close();
  };

  const handlePinSubmit = async (value: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      if (stage === 'changeVerify') {
        if (!(await verifySecurePin(value))) {
          showToast(s.current_pin_incorrect);
          return;
        }
        currentPinRef.current = value;
        moveToStage('changeNew');
        return;
      }

      if (stage === 'clearVerify') {
        if (!(await clearSecurePin(value))) {
          showToast(s.current_pin_incorrect);
          return;
        }
        closePinDialog();
        showToast(s.pin_removed_success);
        return;
      }

      if (stage === 'setupNew' || stage === 'changeNew') {
        if (!isValidSecurePin(value)) {
          showToast(s.pin_must_be_4_8_digits);
          return;
        }
        pendingPinRef.current = value;
        moveToStage(stage === 'setupNew' ? 'setupConfirm' : 'changeConfirm');
        return;
      }

      const pendingPin = pendingPinRef.current;
      if (!pendingPin || (stage === 'changeConfirm' && !currentPinRef.current)) {
        closePinDialog();
        showToast(s.secure_credential_unavailable);
        return;
      }
      if (pendingPin !== value) {
        showToast(s.pins_do_not_match);
        return;
      }
      const saved = stage === 'changeConfirm'
        ? await changeSecurePin(currentPinRef.current, value)
        : await setSecurePin(value);
      if (!saved) {
        showToast(s.secure_credential_unavailable);
        return;
      }
      const successMessage = stage === 'changeConfirm' ? s.pin_changed_success : s.pin_set_success;
      closePinDialog();
      showToast(successMessage);
    } catch {
      showToast(s.secure_credential_unavailable);
    } finally {
      busyRef.current = false;
    }
  };

  const dialogTitle = stage === 'changeVerify'
    ? s.enter_current_pin
    : stage === 'clearVerify'
      ? s.enter_pin_to_remove
      : stage === 'setupConfirm' || stage === 'changeConfirm'
        ? s.confirm_new_pin
        : s.enter_new_pin;

  return (
    <div className="flex h-full flex-col bg-app-bg">
      <SettingsHeader title={s.security_privacy_center} />
      <div
        className="no-scrollbar flex-1 overflow-y-auto pb-8"
        data-scroll-container="main"
        data-scroll-direction="vertical"
      >
        <div className="mx-4 mt-2 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 p-4 text-white shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/18">
              <IcLock size={23} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[16px] font-semibold">{s.device_protection}</div>
              <div className="mt-0.5 text-[12px] text-white/75">
                {hasPin ? s.pin_lock_set : s.screen_lock_not_set}
              </div>
            </div>
          </div>
        </div>

        <PreferenceCategory title={s.screen_lock_security}>
          <PreferenceItem
            title={hasPin ? s.change_screen_lock_pin : s.set_screen_lock_pin}
            summary={s.pin_security_summary}
            value={hasPin ? s.set : undefined}
            showDivider={hasPin}
            itemProps={pinDialog.bindOpen<HTMLDivElement>(hasPin ? 'changeVerify' : 'setupNew')}
          />
          {hasPin ? (
            <PreferenceItem
              title={s.remove_screen_lock_pin}
              showChevron={false}
              showDivider={true}
              itemProps={pinDialog.bindOpen<HTMLDivElement>('clearVerify')}
            />
          ) : null}
          <ListPreference
            title={s.auto_lock_after}
            settingKey="secure_auto_lock_seconds"
            defaultValue="30"
            options={[
              { label: s.after_5_seconds, value: '5' },
              { label: s.after_15_seconds, value: '15' },
              { label: s.after_30_seconds, value: '30' },
              { label: s.after_1_minute, value: '60' },
              { label: s.after_5_minutes, value: '300' },
              { label: s.after_30_minutes, value: '1800' },
            ]}
            showDivider={true}
          />
          <SwitchPreference
            title={s.power_button_locks_immediately}
            settingKey="secure_power_button_locks"
            defaultChecked={true}
            showDivider={false}
          />
        </PreferenceCategory>

        <PreferenceCategory title={s.biometric_unlock}>
          <SwitchPreference
            title={s.fingerprint_unlock_2}
            summary={!hasPin ? s.set_pin_before_biometrics : undefined}
            settingKey="secure_fingerprint_enabled"
            disabled={!hasPin}
            showDivider={true}
          />
          <SwitchPreference
            title={s.face_unlock_2}
            summary={!hasPin ? s.set_pin_before_biometrics : undefined}
            settingKey="secure_face_enabled"
            disabled={!hasPin}
            showDivider={false}
          />
        </PreferenceCategory>

        <PreferenceCategory title={s.lock_screen_privacy}>
          <SwitchPreference
            title={s.show_notifications_on_lock_screen}
            settingKey="secure_lock_screen_notifications"
            defaultChecked={true}
            showDivider={true}
          />
          <SwitchPreference
            title={s.show_sensitive_notification_content}
            settingKey="secure_show_sensitive_notifications"
            disabled={!secure.lockScreen.notificationsEnabled}
            showDivider={false}
          />
        </PreferenceCategory>

        <PreferenceCategory title={s.device_security_services}>
          <SwitchPreference
            title={s.find_device_security}
            summary={s.find_device_security_summary}
            settingKey="secure_find_device_enabled"
            defaultChecked={true}
            showDivider={true}
          />
          <SwitchPreference
            title={s.scan_apps_for_threats}
            summary={s.scan_apps_for_threats_summary}
            settingKey="secure_app_scanning_enabled"
            defaultChecked={true}
            showDivider={true}
          />
          <SwitchPreference
            title={s.allow_unknown_app_sources}
            summary={s.allow_unknown_app_sources_summary}
            settingKey="secure_unknown_sources_allowed"
            showDivider={false}
          />
        </PreferenceCategory>

        <PreferenceCategory title={s.privacy_controls}>
          <SwitchPreference
            title={s.camera_access_control}
            settingKey="secure_camera_access_enabled"
            defaultChecked={true}
            showDivider={true}
          />
          <SwitchPreference
            title={s.microphone_access_control}
            settingKey="secure_microphone_access_enabled"
            defaultChecked={true}
            showDivider={true}
          />
          <SwitchPreference
            title={s.clipboard_access_alerts}
            summary={s.clipboard_access_alerts_summary}
            settingKey="secure_clipboard_access_alerts"
            defaultChecked={true}
            showDivider={true}
          />
          <PreferenceItem
            title={s.permission_management}
            summary={s.manage_app_permissions_summary}
            showDivider={false}
            itemProps={bindTap<HTMLDivElement>('page.open', {
              params: { pageId: 'permission_managing' },
            })}
          />
        </PreferenceCategory>
      </div>

      <InputDialog
        key={stage}
        open={pinDialog.isOpen}
        title={dialogTitle}
        placeholder={s.pin_must_be_4_8_digits}
        inputType="password"
        onClose={closePinDialog}
        confirmAction={{
          id: 'settings.security.pin.submit',
          params: () => ({ operation: stage }),
        }}
        onConfirm={(value) => { void handlePinSubmit(value); }}
      />
      <Toast message={toast.message} visible={toast.visible} />
    </div>
  );
};

export default SecurityPrivacyPage;

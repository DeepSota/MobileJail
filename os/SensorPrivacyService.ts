import { useOsStateStore } from './OsStateStore';
import { PermissionService } from './PermissionService';
import { PERMISSIONS } from './permissions';
import type { AppId } from './types';

export type ProtectedSensor = 'camera' | 'microphone';

function privacyEnabled(sensor: ProtectedSensor): boolean {
  const privacy = useOsStateStore.getState().settings.secure.privacy;
  return sensor === 'camera'
    ? privacy.cameraAccessEnabled
    : privacy.microphoneAccessEnabled;
}

function runtimePermissionAllows(sensor: ProtectedSensor, appId?: AppId): boolean {
  if (!appId) return true;
  const permission = sensor === 'camera' ? PERMISSIONS.CAMERA : PERMISSIONS.RECORD_AUDIO;
  const status = PermissionService.checkPermission(appId, permission);
  // Preserve compatibility for Apps that have not prompted yet; an explicit
  // Settings denial is enforced immediately.
  return status !== 'denied' && status !== 'denied_forever';
}

function deniedError(sensor: ProtectedSensor): DOMException {
  return new DOMException(
    sensor === 'camera' ? 'Camera access is disabled by system privacy controls' : 'Microphone access is disabled by system privacy controls',
    'NotAllowedError',
  );
}

export const SensorPrivacyService = {
  isAccessAllowed(sensor: ProtectedSensor, appId?: AppId): boolean {
    return privacyEnabled(sensor) && runtimePermissionAllows(sensor, appId);
  },

  async getUserMedia(constraints: MediaStreamConstraints, appId?: AppId): Promise<MediaStream> {
    if (constraints.video && !this.isAccessAllowed('camera', appId)) {
      throw deniedError('camera');
    }
    if (constraints.audio && !this.isAccessAllowed('microphone', appId)) {
      throw deniedError('microphone');
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new DOMException('Media capture is unavailable', 'NotSupportedError');
    }
    return navigator.mediaDevices.getUserMedia(constraints);
  },
};

export default SensorPrivacyService;

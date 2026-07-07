import React from 'react';
import { useAppStrings } from '@/os/useAppStrings';
import { strings } from '../../res/strings';
import { stringsEn } from '../../res/strings.en';
import { IcImage, IcDocument, IcVideo, IcAudio, IcCamera, IcFile } from '../../res/icons';

interface AttachmentPanelProps {
  onSelectImage?: () => void;
  onSelectDocument?: () => void;
  onSelectVideo?: () => void;
  onSelectAudio?: () => void;
  onSelectCamera?: () => void;
  onSelectFile?: () => void;
}

const TILE_CONFIG = [
  { type: 'image' as const, labelKey: 'attach_type_image', Icon: IcImage },
  { type: 'document' as const, labelKey: 'attach_type_document', Icon: IcDocument },
  { type: 'video' as const, labelKey: 'attach_type_video', Icon: IcVideo },
  { type: 'audio' as const, labelKey: 'attach_type_audio', Icon: IcAudio },
  { type: 'camera' as const, labelKey: 'attach_type_camera', Icon: IcCamera },
  { type: 'other' as const, labelKey: 'attach_type_other', Icon: IcFile },
];

export const AttachmentPanel: React.FC<AttachmentPanelProps> = ({
  onSelectImage,
  onSelectDocument,
  onSelectVideo,
  onSelectAudio,
  onSelectCamera,
  onSelectFile,
}) => {
  const s = useAppStrings(strings, stringsEn);

  const handlers: Record<string, (() => void) | undefined> = {
    image: onSelectImage,
    document: onSelectDocument,
    video: onSelectVideo,
    audio: onSelectAudio,
    camera: onSelectCamera,
    other: onSelectFile,
  };

  return (
    <div className="px-4 py-3 bg-app-bg border-b border-gray-100">
      <div className="text-[13px] text-gray-500 mb-2">{s.attach_panel_title}</div>
      <div className="grid grid-cols-4 gap-3">
        {TILE_CONFIG.map((opt) => {
          const handler = handlers[opt.type];
          return (
            <button
              key={opt.type}
              type="button"
              onClick={() => handler?.()}
              className="flex flex-col items-center justify-center gap-1.5 py-2 active:bg-gray-100 rounded-lg"
              data-action="compose.attachment.add"
              data-action-type="tap"
              data-action-params={JSON.stringify({ type: opt.type })}
            >
              <div className="w-10 h-10 rounded-full bg-app-primary/10 flex items-center justify-center">
                <opt.Icon size={20} className="text-app-primary" />
              </div>
              <span className="text-[12px] text-app-text">{s[opt.labelKey as keyof typeof s] as string}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default AttachmentPanel;
import React from 'react';
import { IcClose, ICON_REGISTRY } from '../../res/icons';
import type { MailAttachment } from '../../types';
import { createViewIntent, openFileRefInViewer, resolveFileRef } from '../../../../os/FileShareService';

interface AttachmentChipProps {
  attachment: MailAttachment;
  onRemove?: () => void;
  readOnly?: boolean;
  onOpenError?: () => void;
  removeLabel?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const TYPE_ICON: Record<MailAttachment['type'], string> = {
  image: 'IcImage',
  document: 'IcDocument',
  video: 'IcVideo',
  audio: 'IcAudio',
  camera: 'IcCamera',
  other: 'IcFile',
};

export const AttachmentChip: React.FC<AttachmentChipProps> = ({ attachment, onRemove, readOnly, onOpenError, removeLabel }) => {
  const Icon = ICON_REGISTRY[TYPE_ICON[attachment.type]];
  const source = attachment.fileRef ?? attachment.uri;
  const resolved = source ? resolveFileRef(source) : null;
  const canOpen = Boolean(readOnly && source);
  const handleOpen = () => {
    if (!canOpen) return;
    if (!resolved) {
      onOpenError?.();
      return;
    }
    if (attachment.mimeType.startsWith('image/')) {
      const intent = createViewIntent(resolved.ref, { targetAppId: 'gallery' });
      if (!intent || !window.__OS__?.startActivity('gallery', intent)) onOpenError?.();
      return;
    }
    if (!openFileRefInViewer(resolved.ref)) onOpenError?.();
  };
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200 ${canOpen ? 'active:bg-gray-100 cursor-pointer' : ''}`}
      onClick={handleOpen}
      role={canOpen ? 'button' : undefined}
      tabIndex={canOpen ? 0 : undefined}
      onKeyDown={(event) => {
        if ((event.key === 'Enter' || event.key === ' ') && canOpen) {
          event.preventDefault();
          handleOpen();
        }
      }}
      data-action={canOpen ? 'mail.detail.item.open' : undefined}
      data-action-type={canOpen ? 'tap' : undefined}
      data-action-params={canOpen ? JSON.stringify({
        attachmentId: attachment.id,
          fileId: resolved?.ref.fileId ?? attachment.fileRef?.fileId ?? '',
      }) : undefined}
    >
      <div className="w-8 h-8 rounded bg-app-primary/10 flex items-center justify-center flex-shrink-0">
        {Icon && <Icon size={16} className="text-app-primary" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-app-text truncate">{attachment.name}</div>
        <div className="text-[11px] text-gray-400">{formatSize(attachment.size)}</div>
      </div>
      {!readOnly && onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="w-7 h-7 flex items-center justify-center text-gray-400 active:bg-gray-200 rounded-full flex-shrink-0"
          aria-label={removeLabel}
        >
          <IcClose size={14} />
        </button>
      )}
    </div>
  );
};

export default AttachmentChip;

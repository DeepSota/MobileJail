import React from 'react';
import { IcPaperclip, IcStar } from '../../res/icons';
import type { FolderId, MailMessage } from '../../types';
import { useAppStrings } from '@/os/useAppStrings';
import { strings } from '../../res/strings';
import { stringsEn } from '../../res/strings.en';
import { pickAvatarColor } from '../../state';

interface MailItemProps {
  message: MailMessage;
  folder: FolderId;
  attachmentsCount: number;
  onClick: () => void;
}

export const MailItem: React.FC<MailItemProps> = ({ message, folder, attachmentsCount, onClick }) => {
  const s = useAppStrings(strings, stringsEn);
  const isDraft = message.isDraft || folder === 'drafts';
  const displayName = isDraft
    ? (message.to[0] ?? s.list_draft_label)
    : (message.fromName ?? message.from);
  const avatarSeed = isDraft ? (message.to[0] ?? 'me') : (message.fromName ?? message.from);
  const subject = message.subject || s.detail_no_subject;
  const preview = message.body.replace(/\n/g, ' ').slice(0, 80);

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-start gap-3 px-4 py-3 active:bg-gray-50 text-left border-b border-gray-100"
      data-trigger="message.open"
      data-trigger-type="tap"
      data-trigger-params={JSON.stringify({ messageId: message.id })}
    >
      <div
        className="w-11 h-11 rounded-full flex items-center justify-center text-white text-[16px] font-medium flex-shrink-0"
        style={{ backgroundColor: pickAvatarColor(avatarSeed) }}
      >
        {displayName.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {message.isUnread && !isDraft && (
            <span className="w-2 h-2 rounded-full bg-app-primary flex-shrink-0" />
          )}
          <span className={`text-[15px] truncate ${message.isUnread ? 'font-semibold text-app-text' : 'text-app-text'}`}>
            {displayName}
          </span>
          <span className="text-[12px] text-gray-400 ml-auto flex-shrink-0">{message.timestamp}</span>
        </div>
        <div className={`text-[14px] truncate mt-0.5 ${message.isUnread ? 'text-app-text' : 'text-gray-600'}`}>
          {isDraft ? <span className="text-app-primary mr-1">{s.list_draft_label}:</span> : null}
          {subject}
        </div>
        <div className="text-[13px] text-gray-400 truncate mt-0.5 flex items-center gap-1.5">
          {message.isStarred && (
            <IcStar size={12} className="text-amber-400 fill-amber-400 flex-shrink-0" />
          )}
          {attachmentsCount > 0 && (
            <IcPaperclip size={12} className="text-gray-400 flex-shrink-0" />
          )}
          <span className="truncate">{preview}</span>
        </div>
      </div>
    </button>
  );
};

export default MailItem;

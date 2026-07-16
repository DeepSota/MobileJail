import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { IcNavBack, IcReply, IcForward, IcTrash, IcStar, IcEdit, IcPaperclip, ICON_REGISTRY } from '../res/icons';
import {
  useMailProviderState,
  getMessage,
  getAttachments,
  markRead,
  moveToTrash,
  deleteMessageForever,
  restoreFromTrash,
  toggleStar,
  pickAvatarColor,
} from '../state';
import { AttachmentChip } from './components/AttachmentChip';
import { useMailGestures } from '../hooks/useMailGestures';
import { useAppStrings } from '@/os/useAppStrings';
import { strings } from '../res/strings';
import { stringsEn } from '../res/strings.en';
import type { MailMessage } from '../types';
import { Toast } from '@/os/components/Toast';

type DialogState = null | 'trash' | 'delete';

export const MessageDetailPage: React.FC = () => {
  const s = useAppStrings(strings, stringsEn);
  const { messageId = '' } = useParams<{ messageId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { go, back, bindBack } = useMailGestures();
  const providerState = useMailProviderState();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((current) => (current === message ? null : current)), 2200);
  };

  // Pull from provider subscription (re-renders on change).
  const message: MailMessage | undefined = getMessage(messageId);
  const attachments = getAttachments(messageId);

  // Mark read on mount.
  useEffect(() => {
    if (message?.isUnread) markRead(messageId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageId]);

  // Close any open confirm dialog on back key.
  useEffect(() => {
    if (!searchParams.get('confirm')) setDialog(null);
  }, [searchParams]);

  if (!message) {
    return (
      <div className="h-full bg-app-surface flex flex-col" data-status-bar-foreground="dark">
        <div className="h-10 flex-shrink-0" />
        <div className="flex items-center px-4 h-12">
          <button {...bindBack()} className="w-10 h-10 -ml-2 flex items-center justify-center">
            <IcNavBack size={24} className="text-app-text" />
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center text-gray-400">{s.detail_not_found}</div>
      </div>
    );
  }

  const isDraft = message.isDraft || message.folder === 'drafts';
  const isTrash = message.folder === 'trash';
  const avatarSeed = isDraft ? (message.to[0] ?? 'me') : (message.fromName ?? message.from);
  const displayName = isDraft ? (message.to[0] ?? s.list_draft_label) : (message.fromName ?? message.from);

  const confirmParam = searchParams.get('confirm');
  const openConfirm = (kind: 'trash' | 'delete') => {
    setDialog(kind);
    setSearchParams((p) => { p.set('confirm', kind); return p; });
  };
  const closeConfirm = () => {
    setDialog(null);
    setSearchParams((p) => { p.delete('confirm'); return p; });
  };

  const handleStar = () => {
    toggleStar(messageId, !message.isStarred);
  };

  const handleEditDraft = () => {
    go('compose.draft.open', { draftId: messageId });
  };

  const handleReply = () => {
    go('compose.fromReply', { replyId: messageId });
  };

  const handleForward = () => {
    go('compose.fromForward', { forwardId: messageId });
  };

  const confirmTrash = () => {
    moveToTrash(messageId);
    closeConfirm();
    back();
  };

  const confirmDelete = () => {
    deleteMessageForever(messageId);
    closeConfirm();
    back();
  };

  void confirmParam;

  return (
    <div className="h-full bg-app-surface flex flex-col" data-status-bar-foreground="dark">
      <div className="h-10 flex-shrink-0" />

      {/* Toolbar */}
      <div className="flex items-center px-2 h-12 flex-shrink-0 border-b border-gray-100">
        <button {...bindBack()} className="w-10 h-10 flex items-center justify-center">
          <IcNavBack size={24} className="text-app-text" />
        </button>
        <div className="ml-auto flex items-center gap-1">
          {isDraft ? (
            <button type="button" onClick={handleEditDraft} className="w-10 h-10 flex items-center justify-center" aria-label={s.action_edit}>
              <IcEdit size={20} className="text-app-text" />
            </button>
          ) : (
            <>
              <button type="button" onClick={handleReply} className="w-10 h-10 flex items-center justify-center" aria-label={s.action_reply}>
                <IcReply size={20} className="text-app-text" />
              </button>
              <button type="button" onClick={handleForward} className="w-10 h-10 flex items-center justify-center" aria-label={s.action_forward}>
                <IcForward size={20} className="text-app-text" />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={handleStar}
            className="w-10 h-10 flex items-center justify-center"
            aria-label={message.isStarred ? s.action_unstar : s.action_star}
          >
            <IcStar
              size={20}
              className={message.isStarred ? 'text-amber-400 fill-amber-400' : 'text-app-text'}
            />
          </button>
          {isTrash ? (
            <button
              type="button"
              onClick={() => restoreFromTrash(messageId)}
              className="px-2 h-10 flex items-center justify-center"
              aria-label={s.action_restore}
            >
              <span className="text-[13px] text-app-primary">{s.action_restore}</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => (isTrash ? openConfirm('delete') : openConfirm('trash'))}
            className="w-10 h-10 flex items-center justify-center"
            aria-label={s.action_delete}
          >
            <IcTrash size={20} className="text-app-text" />
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div
        className="flex-1 overflow-y-auto px-4 pt-4 pb-6"
        data-scroll-container="main"
        data-scroll-direction="vertical"
      >
        {/* Subject */}
        <div className="flex items-start gap-2 mb-4">
          <h1 className="flex-1 text-[20px] font-semibold text-app-text leading-snug">
            {message.subject || s.detail_no_subject}
          </h1>
          {isDraft && (
            <span className="text-[12px] text-app-primary border border-app-primary rounded px-1.5 py-0.5">
              {s.detail_draft_badge}
            </span>
          )}
        </div>

        {/* Sender + recipients block */}
        <div className="flex items-start gap-3 mb-4">
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center text-white text-[16px] font-medium flex-shrink-0"
            style={{ backgroundColor: pickAvatarColor(avatarSeed) }}
          >
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center">
              <span className="text-[15px] font-medium text-app-text truncate">{displayName}</span>
              <span className="ml-auto text-[12px] text-gray-400 flex-shrink-0">{message.timestamp}</span>
            </div>
            <div className="text-[13px] text-gray-500 mt-0.5">
              <span className="text-gray-400">{s.detail_label_from}: </span>
              <span>{message.from}</span>
            </div>
            <div className="text-[13px] text-gray-500">
              <span className="text-gray-400">{s.detail_label_to}: </span>
              <span>{message.to.join(', ') || '—'}</span>
            </div>
            {message.cc && message.cc.length > 0 && (
              <div className="text-[13px] text-gray-500">
                <span className="text-gray-400">{s.detail_label_cc}: </span>
                <span>{message.cc.join(', ')}</span>
              </div>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="text-[15px] leading-6 text-app-text whitespace-pre-wrap border-t border-gray-100 pt-4">
          {message.body || ''}
        </div>

        {/* Attachments */}
        {attachments.length > 0 && (
          <div className="mt-6 border-t border-gray-100 pt-4">
            <div className="flex items-center gap-1.5 mb-2 text-[13px] text-gray-500">
              <IcPaperclip size={14} />
              <span>{s.detail_label_attachments}（{attachments.length}）</span>
            </div>
            <div className="flex flex-col gap-2">
              {attachments.map((a) => (
                <AttachmentChip
                  key={a.id}
                  attachment={a}
                  readOnly
                  onOpenError={() => showToast(s.attachment_unavailable)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Confirm dialog (URL-driven: ?confirm=trash | delete) */}
      {dialog && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-50" onClick={closeConfirm}>
          <div className="bg-white rounded-2xl w-[280px] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-4 text-center">
              <div className="text-[16px] font-medium text-gray-900 mb-2">
                {dialog === 'delete' ? s.action_delete_forever_confirm : s.action_move_to_trash_confirm}
              </div>
            </div>
            <div className="border-t border-gray-100 flex">
              <button
                className="flex-1 py-3.5 text-[16px] text-gray-500 active:bg-gray-50 border-r border-gray-100"
                onClick={closeConfirm}
              >
                {s.confirm_cancel}
              </button>
              <button
                className="flex-1 py-3.5 text-[16px] font-medium text-red-500 active:bg-gray-50"
                onClick={() => (dialog === 'delete' ? confirmDelete() : confirmTrash())}
              >
                {s.confirm_ok}
              </button>
            </div>
          </div>
        </div>
      )}

      <span className="hidden" aria-hidden>
        {providerState.accounts.length}
        {Object.keys(ICON_REGISTRY).length}
      </span>
      <Toast message={toast ?? ''} visible={Boolean(toast)} />
    </div>
  );
};

export default MessageDetailPage;

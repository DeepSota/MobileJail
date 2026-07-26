import React, { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { IcNavBack, IcPaperclip, IcSend, IcImage, IcFile } from '../res/icons';
import {
  getMessage,
  getAttachments,
  saveDraft,
  sendMessage,
  deleteMessageForever,
  isValidEmail,
  invalidateMailSnapshot,
} from '../state';
import { AttachmentChip } from './components/AttachmentChip';
import { RecipientPicker } from './components/RecipientPicker';
import { SelectFileOverlay } from './SelectFilePage';
import { useMailGestures } from '../hooks/useMailGestures';
import { useActivityContext } from '@/os/ActivityContext';
import { useAppStrings } from '@/os/useAppStrings';
import { strings } from '../res/strings';
import { stringsEn } from '../res/strings.en';
import * as MediaService from '../../../os/MediaService';
import {
  createFileRef,
  hasFileShareIntentData,
  parseIntent as parseFileShareIntent,
  rollbackPrivateAttachments,
} from '../../../os/FileShareService';
import { useActivityBackBlocker } from '../../../os/hooks/useActivityBackBlocker';
import type { FileRefV1 } from '../../../os/types/fileShare';
import type { AttachmentType } from '../types';
import { takeExternalComposeIntent } from '../utils/externalComposeIntent';
import { materializeMailAttachmentsWithCopies } from '../utils/materializeAttachments';
import { appendPickedRecipient, parseRecipientList } from '../utils/recipients';

interface LocalAttachment {
  tempId: string;
  name: string;
  type: AttachmentType;
  mimeType: string;
  size: number;
  uri?: string;
  fileRef?: FileRefV1;
}

type ErrorDialog = null | 'invalid' | 'empty';

let tempCounter = 0;
function nextTempId(): string {
  tempCounter += 1;
  return `local_${tempCounter}`;
}

function parseMailto(url: string): { to: string; subject: string; body: string; cc: string } {
  try {
    const u = new URL(url);
    const to = decodeURIComponent(u.pathname).replace(/^\//, '').trim();
    return {
      to,
      subject: u.searchParams.get('subject') ?? '',
      body: u.searchParams.get('body') ?? '',
      cc: u.searchParams.get('cc') ?? '',
    };
  } catch {
    return { to: '', subject: '', body: '', cc: '' };
  }
}

export const ComposePage: React.FC = () => {
  const s = useAppStrings(strings, stringsEn);
  const { draftId } = useParams<{ draftId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { go, back } = useMailGestures();
  const { activityId } = useActivityContext();

  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [ccVisible, setCcVisible] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [inReplyTo, setInReplyTo] = useState<string | undefined>(undefined);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [errorDialog, setErrorDialog] = useState<ErrorDialog>(null);
  const [unsavedDialog, setUnsavedDialog] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const initialized = useRef(false);
  const submissionInFlight = useRef(false);
  useActivityBackBlocker('mail.compose.commit', sending);

  // File browser overlay driven by searchParam: ?selectFile=document|audio|other
  const fileBrowserType = searchParams.get('selectFile') as AttachmentType | null;
  const showFileBrowser = !!fileBrowserType;
  const replyId = searchParams.get('replyId');
  const forwardId = searchParams.get('forwardId');

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // Read only this Activity's Intent. App-id fallback can return a stale
    // Intent from another Activity and must never seed an internal compose.
    const activityIntent = window.__OS__?.getIntentPayload?.(activityId) ?? null;
    const externalIntent = takeExternalComposeIntent(activityIntent, {
      activityId,
      draftId,
      replyId,
      forwardId,
    });

    // 1. Internal routes always win and discard any stale Activity Intent.
    if (draftId) {
      const msg = getMessage(draftId);
      if (msg) {
        // prepare 可能误写成 string；MailMessage.to 应为 string[]
        const toList = Array.isArray(msg.to) ? msg.to : (msg.to ? [String(msg.to)] : []);
        const ccList = Array.isArray(msg.cc) ? msg.cc : (msg.cc ? [String(msg.cc)] : []);
        setTo(toList.join(', '));
        setCc(ccList.join(', '));
        setCcVisible(ccList.length > 0);
        setSubject(msg.subject);
        setBody(msg.body);
        setInReplyTo(msg.inReplyTo);
        const atts = getAttachments(draftId);
        if (atts.length) {
          setAttachments(
            atts.map((a) => ({
              tempId: a.id,
              name: a.name,
              type: a.type,
              mimeType: a.mimeType,
              size: a.size,
              ...(a.uri ? { uri: a.uri } : {}),
              ...(a.fileRef ? { fileRef: a.fileRef } : {}),
            })),
          );
        }
      }
      return;
    }

    // 2. Reply never inherits attachments from an earlier external share.
    if (replyId) {
      const msg = getMessage(replyId);
      if (msg) {
        setTo(`${msg.fromName ?? msg.from} <${msg.from}>`);
        const subj = msg.subject.startsWith('Re:') ? msg.subject : `Re: ${msg.subject}`;
        setSubject(subj);
        setCcVisible((msg.cc ?? []).length > 0);
        setCc((msg.cc ?? []).join(', '));
        setInReplyTo(replyId);
        setBody('');
      }
      return;
    }

    // 3. Forward keeps the quoted body but does not implicitly copy files.
    if (forwardId) {
      const msg = getMessage(forwardId);
      if (msg) {
        const subj = msg.subject.startsWith('Fwd:') ? msg.subject : `Fwd: ${msg.subject}`;
        setSubject(subj);
        setBody(
          `\n\n---------- ${s.compose_label_subject.split(':')[0] || '转发邮件'} ----------\n` +
          `${s.detail_label_from}: ${msg.fromName ?? msg.from} <${msg.from}>\n` +
          `${s.detail_label_subject}: ${msg.subject}\n\n${msg.body}`,
        );
      }
      return;
    }

    // 4. Only the plain externally-launched /compose entry consumes Intent.
    if (externalIntent) {
      const data = (externalIntent as { data?: unknown }).data;
      const obj = data && typeof data === 'object'
        ? data as Record<string, unknown>
        : null;
      const mailtoUrl = typeof data === 'string'
        ? data
        : (typeof obj?.uri === 'string' ? obj.uri : '');
      if (mailtoUrl.startsWith('mailto:')) {
        const m = parseMailto(mailtoUrl);
        if (m.to) setTo(m.to);
        if (m.subject) setSubject(m.subject);
        if (m.body) setBody(m.body);
        if (m.cc) { setCc(m.cc); setCcVisible(true); }
        return;
      }

      if (obj) {
        if (typeof obj.to === 'string') setTo(obj.to);
        if (typeof obj.subject === 'string') setSubject(obj.subject);
        if (typeof obj.body === 'string') setBody(obj.body);
        if (typeof obj.cc === 'string') { setCc(obj.cc); setCcVisible(true); }
      }

      const shared = parseFileShareIntent(externalIntent);
      if (hasFileShareIntentData(externalIntent) && !shared?.files.length) {
        setToast(s.attachment_unavailable);
        window.setTimeout(() => setToast(null), 2500);
      }
      if (shared?.files.length) {
        setAttachments(shared.files.map((file) => ({
          tempId: nextTempId(),
          name: file.name,
          type: file.mimeType.startsWith('image/')
            ? 'image'
            : file.mimeType.startsWith('video/')
              ? 'video'
              : file.mimeType.startsWith('audio/') ? 'audio' : 'document',
          mimeType: file.mimeType,
          size: file.size,
          uri: file.uri,
          fileRef: file,
        })));
      }
      if (shared?.subject && typeof obj?.subject !== 'string') setSubject(shared.subject);
      if (shared?.text && typeof obj?.body !== 'string') setBody(shared.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, searchParams, activityId]);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 2500);
  };

  const addLocalAttachment = (type: AttachmentType, file: { name: string; mimeType: string; size: number; uri?: string; fileRef?: FileRefV1 }) => {
    setAttachments((arr) => [
      ...arr,
      { tempId: nextTempId(), name: file.name, type, mimeType: file.mimeType, size: file.size, uri: file.uri, fileRef: file.fileRef },
    ]);
  };

  const handleRemoveAttachment = (tempId: string) => {
    setAttachments((arr) => arr.filter((a) => a.tempId !== tempId));
  };

  // --- Real attachment handlers ---

  // Image picker via MediaService
  const handleSelectImage = async () => {
    try {
      const result = await MediaService.pickMedia({ type: 'image', multiple: true, maxSelect: 9 });
      if (result.cancelled || !result.selected.length) return;
      for (const item of result.selected) {
        const fileRef = createFileRef(item.path) ?? createFileRef(item.id) ?? createFileRef(item.uri);
        if (!fileRef) {
          showToast(s.compose_attachment_copy_failed);
          continue;
        }
        addLocalAttachment('image', {
          name: fileRef.name || item.name || 'photo.jpg',
          mimeType: fileRef.mimeType || item.mimeType || 'image/jpeg',
          size: fileRef.size || item.size || 0,
          uri: fileRef.uri,
          fileRef,
        });
      }
    } catch {
      // picker dismissed or not available
    }
  };

  // Document / Audio / Other: open file browser overlay via searchParam
  const openFileBrowser = (attachmentType: AttachmentType) => {
    setSearchParams((p) => { p.set('selectFile', attachmentType); return p; });
  };

  const closeFileBrowser = () => {
    // Use replace so there's no residual history entry for the closed overlay
    setSearchParams((p) => { p.delete('selectFile'); return p; }, { replace: true });
  };

  const handleFileSelect = (file: { path: string; name: string; size: number; mimeType: string }) => {
    const attachType = fileBrowserType || 'other';
    const fileRef = createFileRef(file.path);
    if (!fileRef) {
      showToast(s.compose_attachment_copy_failed);
      return;
    }
    addLocalAttachment(attachType, {
      name: fileRef.name || file.name,
      mimeType: fileRef.mimeType || file.mimeType,
      size: fileRef.size || file.size,
      uri: fileRef.uri,
      fileRef,
    });
    // Replace the ?selectFile history entry with the base compose URL to avoid a stale back-stack entry
    setSearchParams((p) => { p.delete('selectFile'); return p; }, { replace: true });
  };

  const buildDraftInput = (materialized = attachments) => ({
    id: draftId,
    to: parseRecipientList(to),
    cc: parseRecipientList(cc),
    subject,
    body,
    inReplyTo,
    attachments: materialized.map((a) => ({
      name: a.name,
      type: a.type,
      mimeType: a.mimeType,
      size: a.size,
      ...(a.uri ? { uri: a.uri } : {}),
      ...(a.fileRef ? { fileRef: a.fileRef } : {}),
    })),
  });

  const handleSaveDraft = async () => {
    if (submissionInFlight.current) return;
    submissionInFlight.current = true;
    setSending(true);
    const originalAttachments = attachments;
    let createdFiles: FileRefV1[] = [];
    let persisted = false;
    try {
      const result = await materializeMailAttachmentsWithCopies(attachments);
      const materialized = result.attachments;
      createdFiles = result.createdFiles;
      setAttachments(materialized);
      const id = saveDraft(buildDraftInput(materialized));
      persisted = true;
      showToast(s.compose_draft_saved_toast);
      void id;
      go('compose.saveDraft');
    } catch {
      if (!persisted && createdFiles.length) await rollbackPrivateAttachments(createdFiles, 'mail');
      if (!persisted) setAttachments(originalAttachments);
      submissionInFlight.current = false;
      setSending(false);
      showToast(s.compose_attachment_copy_failed);
    }
  };

  const handleSend = async () => {
    if (submissionInFlight.current) return;
    const toList = parseRecipientList(to);
    if (toList.length === 0 || !toList.every((addr) => isValidEmail(addr))) {
      setErrorDialog('invalid');
      return;
    }
    if (!subject.trim() && !body.trim() && attachments.length === 0) {
      setErrorDialog('empty');
      return;
    }
    submissionInFlight.current = true;
    setSending(true);
    const originalAttachments = attachments;
    let materialized: LocalAttachment[] = [];
    let createdFiles: FileRefV1[] = [];
    let persisted = false;
    try {
      const result = await materializeMailAttachmentsWithCopies(attachments);
      materialized = result.attachments;
      createdFiles = result.createdFiles;
      setAttachments(materialized);
      const id = saveDraft(buildDraftInput(materialized));
      persisted = true;
      invalidateMailSnapshot();
      if (!sendMessage(id)) {
        if (!draftId) {
          deleteMessageForever(id);
          persisted = false;
        }
        throw new Error('mail-send-commit-failed');
      }
      invalidateMailSnapshot();
      showToast(s.compose_sent_toast);
      go('compose.send', { messageId: id });
    } catch {
      if (!persisted && createdFiles.length) await rollbackPrivateAttachments(createdFiles, 'mail');
      setAttachments(persisted ? materialized : originalAttachments);
      submissionInFlight.current = false;
      setSending(false);
      showToast(s.compose_attachment_copy_failed);
      return;
    }
  };

  const handleBackPress = () => {
    if (sending) return;
    if (showFileBrowser) {
      closeFileBrowser();
      return;
    }
    const hasContent = to.trim() || subject.trim() || body.trim() || attachments.length > 0;
    if (hasContent) {
      setUnsavedDialog(true);
    } else {
      back();
    }
  };

  return (
    <div className="h-full bg-app-surface flex flex-col" data-status-bar-foreground="dark">
      <div className="h-10 flex-shrink-0" />

      {/* Toolbar */}
      <div className="flex items-center px-2 h-12 flex-shrink-0 border-b border-gray-100">
        <button
          type="button"
          onClick={handleBackPress}
          disabled={sending}
          aria-disabled={sending}
          className="w-10 h-10 flex items-center justify-center disabled:opacity-40"
          aria-label={s.back}
        >
          <IcNavBack size={24} className="text-app-text" />
        </button>
        <span className="text-[16px] font-medium text-app-text ml-1">
          {draftId ? s.compose_title_edit : s.compose_title_new}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={handleSaveDraft}
            disabled={sending}
            data-trigger="compose.saveDraft"
            data-trigger-type="tap"
            className="px-2 h-9 flex items-center text-[14px] text-app-primary active:opacity-70 disabled:opacity-50"
          >
            {s.compose_button_save_draft}
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={sending}
            data-trigger="compose.send"
            data-trigger-type="tap"
            className="px-5 h-10 flex items-center gap-1.5 rounded-full bg-app-primary text-white text-[15px] font-medium shadow-md active:opacity-90 disabled:opacity-50"
          >
            <IcSend size={18} />
            <span>{s.compose_button_send}</span>
          </button>
        </div>
      </div>

      {/* Recipients */}
      <div className="px-4 pt-3 pb-2 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-2 py-1.5">
          <span className="text-[14px] text-gray-500 w-12 flex-shrink-0">{s.compose_label_to}</span>
          <RecipientPicker
            value={to}
            onChange={setTo}
            onPick={(contact) => setTo((current) => appendPickedRecipient(current, contact))}
            placeholder={s.compose_placeholder_recipient}
          />
        </div>
        {ccVisible ? (
          <div className="flex items-center gap-2 py-1.5 border-t border-gray-50">
            <span className="text-[14px] text-gray-500 w-12 flex-shrink-0">{s.compose_label_cc}</span>
            <RecipientPicker
              value={cc}
              onChange={setCc}
              onPick={(contact) => setCc((current) => appendPickedRecipient(current, contact))}
              placeholder={s.compose_placeholder_recipient}
            />
            <button
              type="button"
              onClick={() => setCcVisible(false)}
              className="text-[12px] text-gray-400"
            >
              {s.compose_hide_cc}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCcVisible(true)}
            className="text-[12px] text-gray-400 py-1"
          >
            {s.compose_show_cc}
          </button>
        )}
        <div className="flex items-center gap-2 py-1.5 border-t border-gray-50">
          <span className="text-[14px] text-gray-500 w-12 flex-shrink-0">{s.compose_label_subject}</span>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="flex-1 text-[15px] text-app-text outline-none bg-transparent py-1"
            placeholder={s.compose_placeholder_subject}
          />
        </div>
      </div>

      {/* Body */}
      <div
        className="flex-1 overflow-y-auto px-4 py-3"
        data-scroll-container="main"
        data-scroll-direction="vertical"
      >
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="w-full h-full text-[15px] leading-6 text-app-text outline-none bg-transparent resize-none"
          placeholder={s.compose_placeholder_body}
        />
      </div>

      {/* Attachments list */}
      {attachments.length > 0 && (
        <div className="px-4 pb-2 flex flex-col gap-2 border-t border-gray-100 pt-3 flex-shrink-0">
          {attachments.map((a) => (
            <AttachmentChip
              key={a.tempId}
              attachment={{ id: a.tempId, messageId: '', name: a.name, type: a.type, mimeType: a.mimeType, size: a.size, ...(a.uri ? { uri: a.uri } : {}), ...(a.fileRef ? { fileRef: a.fileRef } : {}) }}
              onRemove={() => handleRemoveAttachment(a.tempId)}
              removeLabel={s.compose_remove_attachment}
            />
          ))}
        </div>
      )}

      {/* Attachment menu (shown after tapping the paperclip) */}
      {showAttachMenu && (
        <div className="px-4 py-3 bg-app-surface border-t border-gray-100 flex-shrink-0">
          <div className="flex gap-4">
            <button
              type="button"
              onClick={() => { setShowAttachMenu(false); handleSelectImage(); }}
              data-action="compose.attachment.add"
              data-action-type="tap"
              data-action-params={JSON.stringify({ type: 'image' })}
              className="flex flex-col items-center gap-2 flex-1 py-3 rounded-xl bg-app-primary/8 active:bg-app-primary/20"
            >
              <div className="w-12 h-12 rounded-full bg-app-primary/15 flex items-center justify-center">
                <IcImage size={24} className="text-app-primary" />
              </div>
              <span className="text-[13px] font-medium text-app-text">{s.attach_type_image}</span>
            </button>
            <button
              type="button"
              onClick={() => { setShowAttachMenu(false); openFileBrowser('other'); }}
              data-action="compose.attachment.add"
              data-action-type="tap"
              data-action-params={JSON.stringify({ type: 'other' })}
              className="flex flex-col items-center gap-2 flex-1 py-3 rounded-xl bg-app-primary/8 active:bg-app-primary/20"
            >
              <div className="w-12 h-12 rounded-full bg-app-primary/15 flex items-center justify-center">
                <IcFile size={24} className="text-app-primary" />
              </div>
              <span className="text-[13px] font-medium text-app-text">{s.attach_type_other}</span>
            </button>
          </div>
        </div>
      )}

      {/* Attachment toggle bar */}
      <div className="flex items-center px-4 h-12 border-t border-gray-100 flex-shrink-0">
        <button
          type="button"
          onClick={() => setShowAttachMenu((v) => !v)}
          className="flex items-center gap-1.5 text-[14px] text-app-primary"
        >
          <IcPaperclip size={18} />
          <span>{s.compose_add_attachment}</span>
          {attachments.length > 0 && <span className="text-gray-400">({attachments.length})</span>}
        </button>
      </div>

      {/* Toast */}
      {toast && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-20 bg-black/80 text-white text-[13px] px-4 py-2 rounded-full z-40">
          {toast}
        </div>
      )}

      {/* Error dialog */}
      {errorDialog && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setErrorDialog(null)}>
          <div className="bg-white rounded-2xl w-[280px] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-4 text-center">
              <div className="text-[16px] font-medium text-gray-900 mb-2">
                {errorDialog === 'invalid' ? s.compose_invalid_recipient_title : s.compose_empty_send_title}
              </div>
              <div className="text-[14px] text-gray-500">
                {errorDialog === 'invalid' ? s.compose_invalid_recipient_body : s.compose_empty_send_body}
              </div>
            </div>
            <div className="border-t border-gray-100">
              <button
                className="w-full py-3.5 text-[16px] font-medium text-app-primary active:bg-gray-50"
                onClick={() => setErrorDialog(null)}
              >
                {errorDialog === 'invalid' ? s.compose_invalid_recipient_ok : s.compose_empty_send_ok}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unsaved-changes dialog */}
      {unsavedDialog && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setUnsavedDialog(false)}>
          <div className="bg-white rounded-2xl w-[280px] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-4 text-center">
              <div className="text-[16px] font-medium text-gray-900 mb-2">{s.unsaved_changes_title}</div>
              <div className="text-[14px] text-gray-500">{s.unsaved_changes_body}</div>
            </div>
            <div className="border-t border-gray-100 flex">
              <button
                className="flex-1 py-3.5 text-[16px] text-gray-500 active:bg-gray-50 border-r border-gray-100"
                onClick={() => setUnsavedDialog(false)}
              >
                {s.unsaved_changes_keep}
              </button>
              <button
                className="flex-1 py-3.5 text-[16px] font-medium text-red-500 active:bg-gray-50"
                onClick={() => { setUnsavedDialog(false); back(); }}
              >
                {s.unsaved_changes_discard}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* File browser overlay (driven by ?selectFile= searchParam) */}
      {showFileBrowser && (
        <SelectFileOverlay
          onSelect={handleFileSelect}
          onClose={closeFileBrowser}
        />
      )}
    </div>
  );
};

export default ComposePage;

import React, { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { IcNavBack, IcPaperclip, IcSend, IcAt, ICON_REGISTRY, IcImage, IcFile } from '../res/icons';
import {
  getMessage,
  getAttachments,
  saveDraft,
  sendMessage,
  extractEmailAddress,
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
import * as FileSystem from '../../../os/FileSystemService';
import type { AttachmentType } from '../types';

interface LocalAttachment {
  tempId: string;
  name: string;
  type: AttachmentType;
  mimeType: string;
  size: number;
  uri?: string;
}

type ErrorDialog = null | 'invalid' | 'empty';

let tempCounter = 0;
function nextTempId(): string {
  tempCounter += 1;
  return `local_${tempCounter}`;
}

function parseRecipients(input: string): string[] {
  return input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(extractEmailAddress);
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
  const { go, back, navigateTo } = useMailGestures();
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

  const initialized = useRef(false);

  // File browser overlay driven by searchParam: ?selectFile=document|audio|other
  const fileBrowserType = searchParams.get('selectFile') as AttachmentType | null;
  const showFileBrowser = !!fileBrowserType;

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // 1. Intent payload (ACTION_VIEW mailto / ACTION_SEND)
    const os = window.__OS__;
    const payload = os?.getIntentPayload?.(activityId) ?? os?.getIntentPayload?.('mail');
    if (payload) {
      const data = (payload as { data?: unknown })?.data;
      if (typeof data === 'string' && data.startsWith('mailto:')) {
        const m = parseMailto(data);
        if (m.to) setTo(m.to);
        if (m.subject) setSubject(m.subject);
        if (m.body) setBody(m.body);
        if (m.cc) { setCc(m.cc); setCcVisible(true); }
        return;
      }
      if (data && typeof data === 'object') {
        const obj = data as Record<string, unknown>;
        if (typeof obj.to === 'string') setTo(obj.to);
        if (typeof obj.subject === 'string') setSubject(obj.subject);
        if (typeof obj.body === 'string') setBody(obj.body);
        if (typeof obj.cc === 'string') { setCc(obj.cc); setCcVisible(true); }
        return;
      }
    }

    // 2. Edit existing draft
    if (draftId) {
      const msg = getMessage(draftId);
      if (msg) {
        setTo(msg.to.join(', '));
        setCc((msg.cc ?? []).join(', '));
        setCcVisible((msg.cc ?? []).length > 0);
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
            })),
          );
        }
      }
      return;
    }

    // 3. Reply
    const replyId = searchParams.get('replyId');
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

    // 4. Forward
    const forwardId = searchParams.get('forwardId');
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, searchParams, activityId]);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 2500);
  };

  const addLocalAttachment = (type: AttachmentType, file: { name: string; mimeType: string; size: number; uri?: string }) => {
    setAttachments((arr) => [
      ...arr,
      { tempId: nextTempId(), name: file.name, type, mimeType: file.mimeType, size: file.size, uri: file.uri },
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
        addLocalAttachment('image', {
          name: item.name || 'photo.jpg',
          mimeType: item.mimeType || 'image/jpeg',
          size: item.size || 0,
          uri: item.uri || item.path,
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
    addLocalAttachment(attachType, {
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      uri: FileSystem.getFileUri(file.path) || undefined,
    });
    // Replace the ?selectFile history entry with the base compose URL to avoid a stale back-stack entry
    setSearchParams((p) => { p.delete('selectFile'); return p; }, { replace: true });
  };

  const buildDraftInput = () => ({
    id: draftId,
    to: parseRecipients(to),
    cc: parseRecipients(cc),
    subject,
    body,
    inReplyTo,
    attachments: attachments.map((a) => ({
      name: a.name,
      type: a.type,
      mimeType: a.mimeType,
      size: a.size,
      ...(a.uri ? { uri: a.uri } : {}),
    })),
  });

  const handleSaveDraft = () => {
    const id = saveDraft(buildDraftInput());
    showToast(s.compose_draft_saved_toast);
    void id;
    navigateTo('/', { replace: true });
  };

  const handleSend = () => {
    const toList = parseRecipients(to);
    if (toList.length === 0 || !toList.every((addr) => isValidEmail(addr))) {
      setErrorDialog('invalid');
      return;
    }
    if (!subject.trim() && !body.trim()) {
      setErrorDialog('empty');
      return;
    }
    const id = saveDraft(buildDraftInput());
    invalidateMailSnapshot();
    sendMessage(id);
    invalidateMailSnapshot();
    showToast(s.compose_sent_toast);
    go('compose.send', { messageId: id });
  };

  const handleBackPress = () => {
    if (showFileBrowser) {
      closeFileBrowser();
      return;
    }
    const hasContent = to.trim() || subject.trim() || body.trim();
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
          className="w-10 h-10 flex items-center justify-center"
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
            className="px-2 h-9 flex items-center text-[14px] text-app-primary active:opacity-70"
          >
            {s.compose_button_save_draft}
          </button>
          <button
            type="button"
            onClick={handleSend}
            className="px-5 h-10 flex items-center gap-1.5 rounded-full bg-app-primary text-white text-[15px] font-medium shadow-md active:opacity-90"
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
            onPick={(c) => setTo(`${c.displayName} <${c.email}>`)}
            placeholder={s.compose_placeholder_recipient}
          />
        </div>
        {ccVisible ? (
          <div className="flex items-center gap-2 py-1.5 border-t border-gray-50">
            <span className="text-[14px] text-gray-500 w-12 flex-shrink-0">{s.compose_label_cc}</span>
            <RecipientPicker
              value={cc}
              onChange={setCc}
              onPick={(c) => setCc(`${c.displayName} <${c.email}>`)}
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
              attachment={{ id: a.tempId, messageId: '', name: a.name, type: a.type, mimeType: a.mimeType, size: a.size, ...(a.uri ? { uri: a.uri } : {}) }}
              onRemove={() => handleRemoveAttachment(a.tempId)}
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

      {/* Silence unused imports */}
      <span className="hidden" aria-hidden>
        {IcAt ? '' : ''}
        {Object.keys(ICON_REGISTRY).length}
      </span>
    </div>
  );
};

export default ComposePage;
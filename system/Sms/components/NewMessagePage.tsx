import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { IcNavBack, IcUser, IcCheck, IcExpand } from '../res/icons';
import { AttachmentPanel } from './AttachmentPanel';
import { NewSelectFilePage } from './NewSelectFilePage';
import { commitOutgoingShare, isValidPhoneNumber, useSmsStore } from '../state';
import { pickMedia } from '../../../os/MediaService';
import { SendArrowIcon, QuestionCircleIcon } from '../res/icons';
import { strings } from '../res/strings';
import { stringsEn } from '../res/strings.en';
import { useAppStrings } from '@/os/useAppStrings';
import ContentResolver from '../../../os/ContentResolver';
import { ensureContactsProviderRegistered } from '../../../os/providers/ContactsProvider';
import { useActivityContext } from '../../../os/ActivityContext';
import { useSmsGestures } from '../hooks/useSmsGestures';
import {
    clonePayloadForApp,
    createPayload as createFileSharePayload,
    hasFileShareIntentData,
    parseIntent as parseFileShareIntent,
    rollbackPrivateAttachments,
} from '../../../os/FileShareService';
import { useActivityBackBlocker } from '../../../os/hooks/useActivityBackBlocker';
import type { IntentPayload } from '../../../os/types/manifest';
import type { SharePayloadV1 } from '../../../os/types/fileShare';
import { SHARE_PAYLOAD_VERSION } from '../../../os/types/fileShare';
import { claimSmsShareIntent } from '../utils/shareIntentConsumption';

interface ContactOption {
    displayName: string;
    phoneNumber: string;
    avatarColor?: string;
}

export const NewMessagePage: React.FC = () => {
    const { go, bindBack, bindTap } = useSmsGestures();
    const s = useAppStrings(strings, stringsEn);
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const showSelectFile = searchParams.get('selectFile') === 'open';
    const { activityId } = useActivityContext();
    const queryParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
    // 接收 intent.data（外部 startActivity ACTION_VIEW scheme=sms 投递时填这里），
    // 没有则回退 URL search params（保持原 deep-link 兼容）。
    const intentPayload = useMemo(() => {
        const os = window.__OS__;
        return (activityId
            ? os?.getIntentPayload?.(activityId)
            : os?.getIntentPayload?.('sms')) as IntentPayload | null;
    }, [activityId]);
    const intentData = intentPayload?.data;
    const incomingShareCandidate = useMemo(
        () => parseFileShareIntent(intentPayload),
        [intentPayload],
    );
    const incomingFileWasMissing = hasFileShareIntentData(intentPayload) && !incomingShareCandidate?.files.length;
    const [incomingShare, setIncomingShare] = useState<SharePayloadV1 | null>(null);
    useEffect(() => {
        if (!intentPayload || !incomingShareCandidate) return;
        if (claimSmsShareIntent(intentPayload, activityId)) setIncomingShare(incomingShareCandidate);
    }, [activityId, incomingShareCandidate, intentPayload]);
    const [showAttachments, setShowAttachments] = useState(false);
    const [recipient, setRecipient] = useState(
        () => (typeof intentData?.address === 'string' ? intentData.address : null)
            ?? queryParams.get('address')
            ?? '',
    );
    const [message, setMessage] = useState(
        () => (typeof intentData?.body === 'string' ? intentData.body : null)
            ?? queryParams.get('body')
            ?? '',
    );
    const [boundPhone, setBoundPhone] = useState<string | null>(null);
    const [selectedRecipients, setSelectedRecipients] = useState<ContactOption[]>([]);
    const showSuggestions = queryParams.get('contacts') === 'open';
    const [inlineError, setInlineError] = useState<'invalidRecipient' | 'attachment' | null>(
        incomingFileWasMissing ? 'attachment' : null,
    );
    const [sending, setSending] = useState(false);
    const sendingRef = useRef(false);
    useActivityBackBlocker('sms.share.send', sending);

    // Consume files selected from NewSelectFilePage
    const pendingNewMessageFiles = useSmsStore((s) => s._temp.pendingNewMessageFiles);
    useEffect(() => {
        if (!pendingNewMessageFiles.length) return;
        const files = useSmsStore.getState().consumePendingNewMessageFiles();
        if (!files.length) return;
        setIncomingShare((prev) => ({
            version: SHARE_PAYLOAD_VERSION,
            files: [...(prev?.files ?? []), ...files],
            mimeType: files.length > 0 ? files[0].mimeType : 'application/octet-stream',
        }));
    }, [pendingNewMessageFiles]);

    const allContacts = useMemo(() => {
        const result: ContactOption[] = [];
        try {
            ensureContactsProviderRegistered();
            const cursor = ContentResolver.query<{
                displayName?: string;
                phones?: { number?: string }[];
                avatarColor?: string;
            }>('content://contacts/contacts');
            for (const c of cursor.items) {
                const name = String(c?.displayName || '').trim();
                const phone = c?.phones?.[0]?.number;
                if (name && phone) {
                    result.push({
                        displayName: name,
                        phoneNumber: String(phone).replace(/\s/g, ''),
                        avatarColor: c?.avatarColor,
                    });
                }
            }
        } catch { /* noop */ }
        return result;
    }, []);

    const filteredContacts = useMemo(() => {
        const q = recipient.trim().toLowerCase();
        if (!q) return allContacts;
        const qDigits = q.replace(/\D/g, '');
        return allContacts.filter(
            (c) =>
                c.displayName.toLowerCase().includes(q) ||
                (qDigits.length > 0 && c.phoneNumber.replace(/\D/g, '').includes(qDigits)),
        );
    }, [allContacts, recipient]);

    const handleRecipientChange = (value: string) => {
        setRecipient(value);
        setBoundPhone(null);
        setInlineError(null);
        if (value.trim() && !showSuggestions) go('contacts.open');
    };

    const handleSelectContact = (contact: ContactOption) => {
        setSelectedRecipients((current) => current.some((item) => item.phoneNumber === contact.phoneNumber)
            ? current
            : [...current, contact]);
        setRecipient('');
        setBoundPhone(null);
        setInlineError(null);
    };

    const toggleAttachments = () => setShowAttachments(!showAttachments);

    const handleSelectImage = async () => {
      setShowAttachments(false);
      try {
        const result = await pickMedia({ type: 'image', multiple: true, maxSelect: 9 });
        if (result.cancelled || !result.selected.length) return;
        // Use item.id (stable node ID → getNodeById) instead of item.uri/item.path.
        // IndexedDB files have empty uri (no cached blob URL), and getNode(path)
        // depends on pathIndex which may be stale; getNodeById queries nodes directly.
        const inputs = result.selected.map((item) => item.id);
        const payload = createFileSharePayload(inputs);
        if (payload.files.length) {
          setIncomingShare((prev) => {
            const merged: SharePayloadV1 = {
              version: SHARE_PAYLOAD_VERSION,
              files: [...(prev?.files ?? []), ...payload.files],
              mimeType: payload.mimeType,
            };
            return merged;
          });
        }
      } catch (err) {
        console.error('[SMS] handleSelectImage failed:', err);
      }
    };

    const handleSelectFile = () => {
      setShowAttachments(false);
      go('new.selectFile');
    };

    const handleSend = async () => {
        if (sendingRef.current) return;
        const trimmedRecipient = recipient.trim();
        if (selectedRecipients.length === 0 && !trimmedRecipient) return;
        if (!message.trim() && !incomingShare?.files.length) return;
        const recipients = [...selectedRecipients];
        if (trimmedRecipient) {
            let phoneNumber = boundPhone;
            let displayName = trimmedRecipient;
            if (!phoneNumber && isValidPhoneNumber(trimmedRecipient)) phoneNumber = trimmedRecipient;
            if (!phoneNumber) {
                const exactContact = allContacts.find((contact) => (
                    contact.displayName.toLocaleLowerCase() === trimmedRecipient.toLocaleLowerCase()
                ));
                if (exactContact) {
                    phoneNumber = exactContact.phoneNumber;
                    displayName = exactContact.displayName;
                }
            }
            if (!phoneNumber) {
                setInlineError('invalidRecipient');
                return;
            }
            if (!recipients.some((item) => item.phoneNumber === phoneNumber)) {
                recipients.push({ displayName, phoneNumber });
            }
        }
        if (recipients.length === 0) {
            setInlineError('invalidRecipient');
            return;
        }
        sendingRef.current = true;
        setSending(true);
        setInlineError(null);
        let saved: SharePayloadV1 | null = null;
        let committed = false;
        try {
            // Clone before creating the conversation.  A failed source read must
            // not leave an empty thread behind in the user's conversation list.
            saved = incomingShare?.files.length
                ? await clonePayloadForApp(incomingShare, 'sms')
                : null;
            const convId = commitOutgoingShare({
                recipients,
                files: saved?.files ?? [],
                text: message,
            });
            committed = true;
            setMessage('');
            setShowAttachments(false);
            go('conversation.open.fromNew', { conversationId: convId });
        } catch {
            if (!committed && saved?.files.length) {
                await rollbackPrivateAttachments(saved.files, 'sms');
            }
            setInlineError('attachment');
            sendingRef.current = false;
            setSending(false);
        }
    };

    const canSend = (recipient.trim().length > 0 || selectedRecipients.length > 0)
        && (message.trim().length > 0 || Boolean(incomingShare?.files.length))
        && !sending;

    return (
        <div className="h-full bg-app-surface flex flex-col relative">
            {/* Status bar spacer */}
            <div className="h-12 flex-shrink-0" />

            {/* Header */}
            <div className="flex items-center px-4 h-12 flex-shrink-0">
                <button
                    className="w-10 h-10 -ml-2 flex items-center justify-center disabled:opacity-40"
                    disabled={sending}
                    aria-disabled={sending}
                    {...bindBack()}
                >
                    <IcNavBack size={24} className="text-app-text" />
                </button>
            </div>

            {/* Title */}
            <div className="px-6 pt-2 pb-4 flex-shrink-0">
                <h1 className="text-[28px] font-bold text-app-text leading-tight">{s.new_message_title}</h1>
            </div>

            {/* Recipient input */}
            <div className="px-6 flex-shrink-0 border-b border-gray-100">
                <div className="flex items-start py-3">
                    <span className="text-[16px] text-gray-400 mr-2">{s.recipient_label}</span>
                    <div className="flex-1 min-w-0 flex flex-wrap items-center gap-1.5">
                        {selectedRecipients.map((selectedRecipient) => (
                            <button
                                key={selectedRecipient.phoneNumber}
                                type="button"
                                onClick={() => setSelectedRecipients((current) => current.filter((item) => item.phoneNumber !== selectedRecipient.phoneNumber))}
                                className="max-w-full rounded-full bg-blue-50 px-2.5 py-1 text-[13px] text-blue-600 truncate"
                                aria-label={`${s.remove_recipient}: ${selectedRecipient.displayName}`}
                            >
                                {selectedRecipient.displayName} ×
                            </button>
                        ))}
                        <input
                            type="text"
                            value={recipient}
                            onChange={(e) => handleRecipientChange(e.target.value)}
                            onFocus={() => {
                                if (!showSuggestions) go('contacts.open');
                            }}
                            className="min-w-[90px] flex-1 text-[16px] text-app-text outline-none"
                            placeholder=""
                        />
                    </div>
                    <button
                        type="button"
                        className="w-10 h-10 flex items-center justify-center text-app-text-muted"
                        {...(showSuggestions ? bindBack() : bindTap('contacts.open'))}
                        aria-label={s.pick_contact_title}
                        aria-expanded={showSuggestions}
                    >
                        {showSuggestions ? (
                            <IcCheck size={22} className="text-blue-500" />
                        ) : (
                            <IcUser size={22} />
                        )}
                    </button>
                </div>
            </div>
            {inlineError ? (
                <div className="mx-6 mt-2 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-600" role="alert">
                    {inlineError === 'invalidRecipient'
                        ? s.error_invalid_recipient_body
                        : s.attachment_send_failed}
                </div>
            ) : null}
            {/* Contact suggestions — replaces spacer+input when visible */}
            {showSuggestions ? (
                <div className="flex-1 overflow-y-auto no-scrollbar">
                    {filteredContacts.length > 0 ? filteredContacts.map((contact) => (
                        <button
                            key={`${contact.displayName}-${contact.phoneNumber}`}
                            className="w-full px-6 py-3.5 flex items-center gap-3 active:bg-gray-50 disabled:opacity-45"
                            onClick={() => handleSelectContact(contact)}
                            disabled={selectedRecipients.some((item) => item.phoneNumber === contact.phoneNumber)}
                            data-action="sms.recipient.select"
                            data-action-type="tap"
                            data-action-params={JSON.stringify({ phone: contact.phoneNumber })}
                        >
                            <div
                                className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[14px] font-medium flex-shrink-0"
                                style={{ backgroundColor: contact.avatarColor || '#3482FF' }}
                            >
                                {contact.displayName.charAt(0)}
                            </div>
                            <div className="flex-1 text-left min-w-0">
                                <div className="text-[15px] text-app-text truncate">{contact.displayName}</div>
                                <div className="text-[13px] text-gray-400 truncate">{contact.phoneNumber}</div>
                            </div>
                        </button>
                    )) : (
                        <div className="px-6 py-10 text-center text-[13px] text-gray-400">
                            {s.empty_search_results}
                        </div>
                    )}
                </div>
            ) : (
                <>
                    <div className="flex-1" />
                    {incomingShare?.files.length ? (
                        <div className="mx-4 mb-2 rounded-xl border border-gray-100 bg-app-surface px-3 py-2">
                            <div className="text-[12px] text-gray-400 mb-1">{s.shared_files}</div>
                            {incomingShare.files.map((file) => (
                                <div key={file.fileId} className="flex items-center gap-2 py-1">
                                    <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-[10px] font-semibold text-blue-600">
                                        {(file.name.split('.').pop() || s.attachment_file).slice(0, 4).toUpperCase()}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate text-[13px] text-app-text">{file.name}</div>
                                        <div className="text-[11px] text-gray-400">
                                            {file.size >= 1024 * 1024
                                                ? `${(file.size / (1024 * 1024)).toFixed(1)} ${s.file_size_mb}`
                                                : file.size >= 1024
                                                  ? `${(file.size / 1024).toFixed(1)} ${s.file_size_kb}`
                                                  : `${file.size} ${s.file_size_bytes}`}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : null}
                    {/* Bottom input area */}
                    <div className="flex-shrink-0 border-t border-gray-100 bg-app-bg">
                        {showAttachments && <AttachmentPanel onSelectImage={handleSelectImage} onSelectFile={handleSelectFile} />}
                        <div className="flex items-center px-3 py-2 gap-2">
                            <button
                                className="w-11 h-11 flex items-center justify-center bg-app-surface rounded-lg"
                                onClick={toggleAttachments}
                            >
                                {showAttachments ? (
                                    <IcExpand size={20} className="text-gray-600" />
                                ) : (
                                    <div className="grid grid-cols-3 gap-0.5">
                                        {[...Array(9)].map((_, i) => (
                                            <div key={i} className="w-1 h-1 bg-gray-500 rounded-sm" />
                                        ))}
                                    </div>
                                )}
                            </button>
                            <div className="flex-1 bg-app-surface rounded-2xl flex items-end px-4 py-2.5">
                                <textarea
                                    value={message}
                                    onChange={(e) => {
                                        setMessage(e.target.value);
                                        setInlineError(null);
                                        e.target.style.height = 'auto';
                                        e.target.style.height = e.target.scrollHeight + 'px';
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key !== 'Enter') return;
                                        e.preventDefault();
                                        if (!e.repeat && !e.nativeEvent.isComposing && canSend) void handleSend();
                                    }}
                                    rows={1}
                                    className="flex-1 text-[14px] text-app-text outline-none resize-none overflow-hidden max-h-[120px]"
                                    placeholder={s.sms_placeholder}
                                />
                                <button className="ml-2 text-blue-500 flex-shrink-0 self-end mb-0.5">
                                    <QuestionCircleIcon />
                                </button>
                            </div>
                            <button
                                type="button"
                                className={`w-11 h-11 flex items-center justify-center rounded-full ${canSend ? 'bg-app-primary' : 'bg-gray-200'}`}
                                onPointerDown={(e) => e.preventDefault()}
                                onClick={() => { void handleSend(); }}
                                data-action="sms.new.send"
                                data-action-type="tap"
                                disabled={!canSend}
                            >
                                <SendArrowIcon active={canSend} />
                            </button>
                        </div>
                    </div>
                </>
            )}

            {showSelectFile && (
                <div className="absolute inset-0 z-50 bg-app-bg">
                    <NewSelectFilePage />
                </div>
            )}
        </div>
    );
};

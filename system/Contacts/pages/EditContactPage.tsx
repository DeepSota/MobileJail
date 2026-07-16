import React, { useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Toast } from '@/os/components/Toast';
import { useLocale } from '@/os/locale';
import { useAppStrings } from '@/os/useAppStrings';
import { SymbolIcon } from '../components/SymbolIcon';
import { useContactsGestures } from '../hooks/useContactsGestures';
import { IcSymbolClose, IcSymbolExpandMore, IcSymbolOk } from '../res/icons';
import { strings } from '../res/strings';
import { stringsEn } from '../res/strings.en';
import { updateContact, useContact } from '../state';
import type { ContactPhone, ContactEmail } from '../types';

export const EditContactPage: React.FC = () => {
  const locale = useLocale();
  const isEnglish = locale === 'en';
  const { contactId } = useParams<{ contactId: string }>();
  const { bindBack, back } = useContactsGestures();
  const s = useAppStrings(strings, stringsEn);
  const contact = useContact(contactId);

  const [toast, setToast] = useState<{ visible: boolean; message: string }>({ visible: false, message: '' });
  const toastTimerRef = useRef<number | null>(null);
  const showToast = (message: string) => {
    setToast({ visible: true, message });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast({ visible: false, message: '' }), 1400);
  };

  const [name, setName] = useState(contact?.displayName ?? '');
  const [company, setCompany] = useState(contact?.company ?? '');
  const [title, setTitle] = useState(contact?.title ?? '');
  const [phones, setPhones] = useState<ContactPhone[]>(contact?.phones ?? []);
  const [emails, setEmails] = useState<ContactEmail[]>(contact?.emails ?? []);
  const [notes, setNotes] = useState(contact?.notes ?? '');

  if (!contact) {
    return (
      <div className="h-full w-full bg-app-surface">
        <div className="h-10" />
        <div className="px-4 h-12 flex items-center gap-2">
          <button
            type="button"
            {...bindBack<HTMLButtonElement>({ stopPropagation: true })}
            className="w-10 h-10 rounded-full flex items-center justify-center active:bg-black/5"
            aria-label={isEnglish ? 'Back' : '返回'}
          >
            <SymbolIcon name={IcSymbolClose} size={22} className="text-app-text" />
          </button>
          <div className="flex-1 text-[18px] font-semibold text-app-text">{s.edit}</div>
        </div>
        <div className="px-6 py-10 text-[13px] text-gray-400">{s.contact_not_found}</div>
      </div>
    );
  }

  const save = () => {
    if (!name.trim()) {
      showToast(s.new_contact_name_required);
      return;
    }

    updateContact(contact.id, {
      displayName: name.trim(),
      company: company.trim() || undefined,
      title: title.trim() || undefined,
      phones: phones.filter((p) => p.number.trim()),
      emails: emails.filter((e) => e.email.trim()),
      notes: notes.trim() || undefined,
    });
  };

  // Save + back (✓ button)
  const handleSave = () => {
    save();
    back(1);
  };

  const addPhone = () => {
    setPhones((prev) => [
      ...prev,
      { id: `p_new_${Date.now()}`, label: '手机', number: '', isPrimary: prev.length === 0 },
    ]);
  };

  const updatePhone = (index: number, field: keyof ContactPhone, value: string) => {
    setPhones((prev) => prev.map((p, i) => (i === index ? { ...p, [field]: value } : p)));
  };

  const removePhone = (index: number) => {
    setPhones((prev) => prev.filter((_, i) => i !== index));
  };

  const addEmail = () => {
    setEmails((prev) => [
      ...prev,
      { id: `e_new_${Date.now()}`, label: '工作', email: '', isPrimary: prev.length === 0 },
    ]);
  };

  const updateEmail = (index: number, field: keyof ContactEmail, value: string) => {
    setEmails((prev) => prev.map((e, i) => (i === index ? { ...e, [field]: value } : e)));
  };

  const removeEmail = (index: number) => {
    setEmails((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="h-full w-full bg-app-bg flex flex-col">
      <Toast visible={toast.visible} message={toast.message} />

      <div className="flex-shrink-0 z-30 bg-app-bg">
        <div className="h-10" />
        <div className="px-4 h-12 flex items-center justify-between">
          <button
            type="button"
            aria-label={isEnglish ? 'Back' : '返回'}
            onClick={() => back(1)}
            className="w-10 h-10 rounded-full flex items-center justify-center active:bg-black/5"
          >
            <SymbolIcon name={IcSymbolClose} size={22} className="text-app-text" />
          </button>

          <div className="text-[18px] font-semibold text-app-text">{s.edit}</div>

          <button
            type="button"
            aria-label={isEnglish ? 'Save' : '保存'}
            onClick={handleSave}
            data-keep-keyboard
            className="w-10 h-10 rounded-full flex items-center justify-center active:bg-black/5"
          >
            <SymbolIcon name={IcSymbolOk} size={22} className="text-app-text" />
          </button>
        </div>
      </div>

      <div
        className="flex-1 overflow-y-auto no-scrollbar pb-10"
        data-scroll-container="main"
        data-scroll-direction="vertical"
      >
        {/* Name */}
        <div className="mx-4 mt-4 bg-app-surface rounded-3xl overflow-hidden">
          <div className="px-5 py-4">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={s.new_contact_placeholder_name}
              className="w-full text-[18px] font-semibold text-app-text outline-none placeholder:text-gray-300"
              autoFocus
            />
          </div>
        </div>

        {/* Notes */}
        <div className="mx-4 mt-3 bg-app-surface rounded-3xl overflow-hidden">
          <div className="px-5 py-4 flex items-center gap-2 border-b border-black/5">
            <div className="text-[16px] font-semibold text-app-text">{s.section_notes}</div>
          </div>
          <div className="px-5 py-4">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={isEnglish ? 'Add notes' : '添加备注'}
              className="w-full text-[16px] text-app-text outline-none placeholder:text-gray-300 resize-none min-h-[80px]"
              rows={3}
            />
          </div>
        </div>

        {/* Company / Title */}
        <div className="mx-4 mt-3 bg-app-surface rounded-3xl overflow-hidden">
          <div className="px-5 py-4 border-b border-black/5">
            <input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder={s.new_contact_placeholder_company}
              className="w-full text-[16px] text-app-text outline-none placeholder:text-gray-300"
            />
          </div>
          <div className="px-5 py-4">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={s.new_contact_placeholder_job_title}
              className="w-full text-[16px] text-app-text outline-none placeholder:text-gray-300"
            />
          </div>
        </div>

        {/* Phones */}
        <div className="mx-4 mt-3 bg-app-surface rounded-3xl overflow-hidden">
          {phones.map((phone, index) => (
            <React.Fragment key={phone.id}>
              {index > 0 && <div className="h-px bg-black/5 ml-5" />}
              <div className="px-5 py-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[14px] text-gray-400">
                    {phone.label || s.new_contact_label_mobile}
                  </div>
                  {phones.length > 1 && (
                    <button
                      type="button"
                      className="text-[13px] text-red-400 active:text-red-600"
                      onClick={() => removePhone(index)}
                    >
                      {s.delete}
                    </button>
                  )}
                </div>
                <input
                  value={phone.number}
                  onChange={(e) => updatePhone(index, 'number', e.target.value)}
                  placeholder={s.new_contact_placeholder_phone}
                  className="w-full text-[16px] text-app-text outline-none placeholder:text-gray-300"
                  inputMode="tel"
                />
              </div>
            </React.Fragment>
          ))}
          <div className="px-5 py-3 border-t border-black/5">
            <button
              type="button"
              className="w-full text-[14px] text-blue-500 font-semibold active:text-blue-700"
              onClick={addPhone}
            >
              + {isEnglish ? 'Add phone' : '添加电话'}
            </button>
          </div>
        </div>

        {/* Emails */}
        <div className="mx-4 mt-3 bg-app-surface rounded-3xl overflow-hidden">
          {emails.map((email, index) => (
            <React.Fragment key={email.id}>
              {index > 0 && <div className="h-px bg-black/5 ml-5" />}
              <div className="px-5 py-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[14px] text-gray-400">
                    {email.label || s.new_contact_label_work}
                  </div>
                  {emails.length > 1 && (
                    <button
                      type="button"
                      className="text-[13px] text-red-400 active:text-red-600"
                      onClick={() => removeEmail(index)}
                    >
                      {s.delete}
                    </button>
                  )}
                </div>
                <input
                  value={email.email}
                  onChange={(e) => updateEmail(index, 'email', e.target.value)}
                  placeholder={s.new_contact_placeholder_email}
                  className="w-full text-[16px] text-app-text outline-none placeholder:text-gray-300"
                  inputMode="email"
                />
              </div>
            </React.Fragment>
          ))}
          <div className="px-5 py-3 border-t border-black/5">
            <button
              type="button"
              className="w-full text-[14px] text-blue-500 font-semibold active:text-blue-700"
              onClick={addEmail}
            >
              + {isEnglish ? 'Add email' : '添加邮箱'}
            </button>
          </div>
        </div>

        </div>
    </div>
  );
};
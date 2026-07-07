import React, { useMemo } from 'react';
import ContentResolver from '@/os/ContentResolver';
import { ensureContactsProviderRegistered } from '@/os/providers/ContactsProvider';
import { useAppStrings } from '@/os/useAppStrings';
import { strings } from '../../res/strings';
import { stringsEn } from '../../res/strings.en';
import { pickAvatarColor, isValidEmail } from '../../state';

interface ContactOption {
  displayName: string;
  email: string;
  avatarColor?: string;
}

export interface RecipientPickerProps {
  value: string;
  onChange: (value: string) => void;
  onPick: (contact: ContactOption) => void;
  placeholder: string;
}

export const allContactEmails = (): ContactOption[] => {
  try {
    ensureContactsProviderRegistered();
    const cursor = ContentResolver.query<{
      displayName?: string;
      emails?: { email?: string }[];
      avatarColor?: string;
    }>('content://contacts/contacts');
    const result: ContactOption[] = [];
    for (const c of cursor.items) {
      const name = String(c?.displayName || '').trim();
      const email = c?.emails?.[0]?.email;
      if (name && email) {
        result.push({ displayName: name, email, avatarColor: c?.avatarColor });
      }
    }
    return result;
  } catch {
    return [];
  }
};

export const RecipientPicker: React.FC<RecipientPickerProps> = ({
  value,
  onChange,
  onPick,
  placeholder,
}) => {
  const s = useAppStrings(strings, stringsEn);
  const allContacts = useMemo(() => allContactEmails(), []);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return allContacts;
    return allContacts.filter(
      (c) => c.displayName.toLowerCase().includes(q) || c.email.toLowerCase().includes(q),
    );
  }, [allContacts, value]);

  const suggest = value.trim().length > 0 && filtered.length > 0;

  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 w-full text-[15px] text-app-text outline-none bg-transparent py-2"
      />
      {suggest && (
        <div className="absolute left-0 right-0 top-full z-30 bg-app-surface border border-gray-100 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {filtered.slice(0, 8).map((c) => (
            <button
              key={`${c.email}`}
              type="button"
              onClick={() => onPick(c)}
              className="w-full px-4 py-2.5 flex items-center gap-3 active:bg-gray-50 text-left"
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[13px] font-medium flex-shrink-0"
                style={{ backgroundColor: c.avatarColor || pickAvatarColor(c.email) }}
              >
                {c.displayName.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] text-app-text truncate">{c.displayName}</div>
                <div className="text-[12px] text-gray-400 truncate">{c.email}</div>
              </div>
            </button>
          ))}
        </div>
      )}
      <span className="sr-only">{isValidEmail(value) ? '' : s.compose_invalid_recipient_body}</span>
    </div>
  );
};

export default RecipientPicker;

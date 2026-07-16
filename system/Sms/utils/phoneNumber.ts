import type { Conversation } from '../types';

/**
 * Canonical phone identity used for SMS thread matching.
 *
 * Formatting characters are ignored and mainland-China country prefixes are
 * collapsed so `+86 138...`, `0086 138...`, and `138...` address one thread.
 * Short service numbers (for example 10086) are intentionally preserved.
 */
export function normalizeSmsPhoneNumber(value: string | null | undefined): string {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.startsWith('0086') && digits.length === 15) digits = digits.slice(4);
  if (digits.startsWith('86') && digits.length === 13) digits = digits.slice(2);
  return digits;
}

export function isValidSmsPhoneNumber(value: string): boolean {
  if (!/^[\d\s+\-()]+$/.test(value.trim())) return false;
  return /^\d{3,}$/.test(normalizeSmsPhoneNumber(value));
}

/** Match a thread without ever falling back to a potentially ambiguous name. */
export function findSmsConversationByIdentity(
  conversations: readonly Conversation[],
  recipient: string,
  phoneNumber?: string,
): Conversation | undefined {
  const normalizedPhone = normalizeSmsPhoneNumber(phoneNumber);
  if (normalizedPhone) {
    return conversations.find(
      (conversation) => normalizeSmsPhoneNumber(conversation.phoneNumber) === normalizedPhone,
    );
  }
  const normalizedRecipient = recipient.trim();
  return conversations.find((conversation) => conversation.sender === normalizedRecipient);
}

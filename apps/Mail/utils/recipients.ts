import { extractEmailAddress } from '../state';

export interface PickedEmailContact {
  displayName: string;
  email: string;
}

export function parseRecipientList(input: string): string[] {
  const seen = new Set<string>();
  return input
    .split(',')
    .map((part) => extractEmailAddress(part.trim()))
    .filter((email) => {
      const normalized = email.toLocaleLowerCase();
      if (!email || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
}

/** Replace the current search token and keep earlier recipients intact. */
export function appendPickedRecipient(
  input: string,
  contact: PickedEmailContact,
): string {
  const parts = input.split(',');
  const committed = parts.slice(0, -1).map((part) => part.trim()).filter(Boolean);
  const email = contact.email.trim();
  const duplicate = committed.some(
    (part) => extractEmailAddress(part).toLocaleLowerCase() === email.toLocaleLowerCase(),
  );
  const next = duplicate
    ? committed
    : [...committed, `${contact.displayName.trim() || email} <${email}>`];
  return next.length > 0 ? `${next.join(', ')}, ` : '';
}

/** Only the token after the final comma participates in contact search. */
export function getRecipientSearchToken(input: string): string {
  return input.split(',').pop()?.trim() ?? '';
}

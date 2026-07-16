import { describe, expect, it } from 'vitest';
import {
  appendPickedRecipient,
  getRecipientSearchToken,
  parseRecipientList,
} from '@/apps/Mail/utils/recipients';

describe('Mail multi-recipient contact input', () => {
  it('keeps earlier recipients when a second contact is selected', () => {
    const first = appendPickedRecipient('lin', {
      displayName: '林晓',
      email: 'lin@example.com',
    });
    const second = appendPickedRecipient(`${first}chen`, {
      displayName: '陈晨',
      email: 'chen@example.com',
    });

    expect(second).toBe('林晓 <lin@example.com>, 陈晨 <chen@example.com>, ');
    expect(parseRecipientList(second)).toEqual(['lin@example.com', 'chen@example.com']);
  });

  it('searches only the token after the final comma', () => {
    expect(getRecipientSearchToken('林晓 <lin@example.com>, che')).toBe('che');
  });

  it('deduplicates selected and manually entered addresses case-insensitively', () => {
    expect(parseRecipientList('A <USER@example.com>, user@example.com, b@example.com')).toEqual([
      'USER@example.com',
      'b@example.com',
    ]);
  });

  it('does not append the same contact twice', () => {
    expect(appendPickedRecipient('林晓 <lin@example.com>, lin', {
      displayName: '林晓',
      email: 'lin@example.com',
    })).toBe('林晓 <lin@example.com>, ');
  });
});

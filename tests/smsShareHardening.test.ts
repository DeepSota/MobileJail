import { describe, expect, it } from 'vitest';
import { NAVIGATION_DECLARATION } from '../system/Sms/navigation.declaration';
import type { Conversation } from '../system/Sms/types';
import {
  findSmsConversationByIdentity,
  isValidSmsPhoneNumber,
  normalizeSmsPhoneNumber,
} from '../system/Sms/utils/phoneNumber';
import { claimSmsShareIntent } from '../system/Sms/utils/shareIntentConsumption';
import type { IntentPayload } from '../os/types/manifest';
import { commitOutgoingShare } from '../system/Sms/state';
import { useSmsProviderStore } from '../os/providers/SmsProvider';

function conversation(id: string, sender: string, phoneNumber?: string): Conversation {
  return {
    id,
    sender,
    phoneNumber,
    timestamp: '',
    avatarText: sender.slice(0, 1),
    isUnread: false,
  };
}

describe('SMS recipient identity hardening', () => {
  it('normalizes formatted mainland-China numbers and keeps service numbers', () => {
    expect(normalizeSmsPhoneNumber('+86 138-0013-8000')).toBe('13800138000');
    expect(normalizeSmsPhoneNumber('0086 (138) 0013 8000')).toBe('13800138000');
    expect(normalizeSmsPhoneNumber('10086')).toBe('10086');
    expect(isValidSmsPhoneNumber('abc123')).toBe(false);
  });

  it('matches by normalized number before name and never guesses a same-name thread', () => {
    const conversations = [
      conversation('alice-work', '小林', '13800138000'),
      conversation('alice-home', '小林', '13900139000'),
    ];

    expect(findSmsConversationByIdentity(conversations, '小林', '+86 139 0013 9000')?.id)
      .toBe('alice-home');
    expect(findSmsConversationByIdentity(conversations, '小林', '13700137000'))
      .toBeUndefined();
    expect(findSmsConversationByIdentity(conversations, '小林')?.id).toBe('alice-work');
  });
});

describe('SMS share Intent consumption', () => {
  it('consumes one Intent object once per Activity but accepts a new Intent object', () => {
    const first: IntentPayload = { action: 'ACTION_SEND', type: 'application/octet-stream' };
    const second: IntentPayload = { ...first };

    expect(claimSmsShareIntent(first, 'act-1')).toBe(true);
    expect(claimSmsShareIntent(first, 'act-1')).toBe(false);
    expect(claimSmsShareIntent(first, 'act-2')).toBe(true);
    expect(claimSmsShareIntent(second, 'act-1')).toBe(true);
  });
});

describe('SMS attachment action declaration', () => {
  it('scopes attachment opening to an exact message and file', () => {
    const route = NAVIGATION_DECLARATION.routes.find(
      (item) => item.path === '/conversation/:conversationId',
    );
    const action = route?.uiStates[0]?.actions?.find(
      (item) => item.id === 'sms.attachment.open',
    );

    expect(action).toMatchObject({
      scope: 'item',
      paramsSchema: { messageId: 'string', fileId: 'string' },
    });
  });
});

describe('SMS group-recipient commit', () => {
  it('creates one reusable group thread for the same normalized recipients', () => {
    useSmsProviderStore.setState({ conversations: [], messagesByConversationId: {} }, true);

    const firstId = commitOutgoingShare({
      recipients: [
        { displayName: '小林', phoneNumber: '+86 138-0013-8000' },
        { displayName: '阿杰', phoneNumber: '139 0013 9000' },
      ],
      files: [],
      text: '会议资料已发送',
    });
    const secondId = commitOutgoingShare({
      recipients: [
        { displayName: '阿杰', phoneNumber: '13900139000' },
        { displayName: '小林', phoneNumber: '13800138000' },
      ],
      files: [],
      text: '收到请回复',
    });

    const state = useSmsProviderStore.getState();
    expect(secondId).toBe(firstId);
    expect(state.conversations).toHaveLength(1);
    expect(state.conversations[0]).toMatchObject({
      phoneNumbers: ['13800138000', '13900139000'],
      participantNames: ['小林', '阿杰'],
    });
    expect(state.messagesByConversationId[firstId]).toHaveLength(2);
  });
});

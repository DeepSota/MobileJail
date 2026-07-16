import { beforeEach, describe, expect, it } from 'vitest';
import type { IntentPayload } from '@/os/types/manifest';
import {
  resetExternalComposeIntentConsumptionForTests,
  takeExternalComposeIntent,
} from '@/apps/Mail/utils/externalComposeIntent';

const sharedFileIntent: IntentPayload = {
  action: 'ACTION_SEND',
  type: 'application/pdf',
  data: { stream: 'content://simfs/files/report' },
};

describe('Mail external compose Intent consumption', () => {
  beforeEach(() => resetExternalComposeIntentConsumptionForTests());

  it('consumes an external ACTION_SEND only once per Activity', () => {
    const context = { activityId: 'act_mail_1' };
    expect(takeExternalComposeIntent(sharedFileIntent, context)).toBe(sharedFileIntent);
    expect(takeExternalComposeIntent(sharedFileIntent, context)).toBeNull();
    expect(takeExternalComposeIntent(sharedFileIntent, { activityId: 'act_mail_2' })).toBe(sharedFileIntent);
  });

  it('discards stale external files on draft, reply, and forward entries', () => {
    for (const context of [
      { activityId: 'act_draft', draftId: 'draft_1' },
      { activityId: 'act_reply', replyId: 'message_1' },
      { activityId: 'act_forward', forwardId: 'message_2' },
    ]) {
      expect(takeExternalComposeIntent(sharedFileIntent, context)).toBeNull();
      // Later navigation to plain /compose in the same Activity must not replay it.
      expect(takeExternalComposeIntent(sharedFileIntent, { activityId: context.activityId })).toBeNull();
    }
  });

  it('accepts mailto ACTION_VIEW but ignores unrelated Activity Intents', () => {
    const mailto = {
      action: 'ACTION_VIEW',
      scheme: 'mailto',
      data: 'mailto:user@example.com',
    } as unknown as IntentPayload;
    expect(takeExternalComposeIntent(mailto, { activityId: 'act_mailto' })).toBe(mailto);
    expect(takeExternalComposeIntent(
      { action: 'ACTION_VIEW', scheme: 'https', data: {} },
      { activityId: 'act_web' },
    )).toBeNull();
  });
});


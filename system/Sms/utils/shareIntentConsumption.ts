import type { IntentPayload } from '../../../os/types/manifest';

const consumedShareIntents = new WeakMap<object, Set<string>>();

/**
 * Claim an ACTION_SEND Intent once for a specific Activity.
 *
 * TaskManager keeps the Intent object stable for the Activity lifetime.  This
 * lets a new Intent object be consumed even when it contains the same file,
 * while navigating away from and back to `/new` cannot replay the old object.
 */
export function claimSmsShareIntent(intent: IntentPayload, activityId: string): boolean {
  const consumerId = activityId || 'sms-root';
  const consumedBy = consumedShareIntents.get(intent) ?? new Set<string>();
  if (consumedBy.has(consumerId)) return false;
  consumedBy.add(consumerId);
  consumedShareIntents.set(intent, consumedBy);
  return true;
}


import type { IntentPayload } from '@/os/types/manifest';

const consumedActivityIds = new Set<string>();

export interface ExternalComposeContext {
  activityId: string;
  draftId?: string;
  replyId?: string | null;
  forwardId?: string | null;
}

function isExternalComposeIntent(intent: IntentPayload | null | undefined): intent is IntentPayload {
  if (!intent) return false;
  if (intent.action === 'ACTION_SEND' || intent.action === 'ACTION_SEND_MULTIPLE') return true;
  if (intent.action !== 'ACTION_VIEW') return false;
  if (intent.scheme === 'mailto') return true;
  const data = (intent as { data?: unknown }).data;
  return typeof data === 'string' && data.startsWith('mailto:');
}

/**
 * Return an external compose Intent at most once for each OS Activity.
 *
 * Internal draft/reply/forward routes deliberately discard an attached stale
 * Intent, preventing it from being replayed if that Activity later navigates
 * back to the plain `/compose` route.
 */
export function takeExternalComposeIntent(
  intent: IntentPayload | null | undefined,
  context: ExternalComposeContext,
): IntentPayload | null {
  if (!context.activityId || !isExternalComposeIntent(intent)) return null;
  if (consumedActivityIds.has(context.activityId)) return null;

  consumedActivityIds.add(context.activityId);
  if (context.draftId || context.replyId || context.forwardId) return null;
  return intent;
}

/** @internal Test isolation for this volatile, Activity-scoped registry. */
export function resetExternalComposeIntentConsumptionForTests(): void {
  consumedActivityIds.clear();
}

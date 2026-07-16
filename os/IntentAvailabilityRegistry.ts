/** Runtime capability gates for intent filters whose availability is stateful. */
const availability = new Map<string, boolean>();

export const IntentAvailabilityRegistry = {
  set(key: string, available: boolean): void {
    const normalized = String(key ?? '').trim();
    if (!normalized) return;
    availability.set(normalized, available);
  },

  isAvailable(key: string): boolean {
    const normalized = String(key ?? '').trim();
    return normalized ? availability.get(normalized) === true : true;
  },

  clear(key: string): void {
    availability.delete(String(key ?? '').trim());
  },
};

export default IntentAvailabilityRegistry;

export type LeadPromptOutcome = 'sent' | 'repeat' | 'failed'

// Why 3 s: a double press must not start two turns; the terminal band keeps the same window.
const RESEND_AFTER_MS = 3000

export function createLeadPromptSender(
  now: () => number
): (key: string, send: () => Promise<boolean>) => Promise<LeadPromptOutcome> {
  const blockedUntil = new Map<string, number>()
  return async (key, send) => {
    if ((blockedUntil.get(key) ?? -Infinity) > now()) {
      return 'repeat'
    }
    blockedUntil.set(key, Infinity)
    const sent = await send().catch(() => false)
    if (!sent) {
      blockedUntil.delete(key)
      return 'failed'
    }
    blockedUntil.set(key, now() + RESEND_AFTER_MS)
    return 'sent'
  }
}

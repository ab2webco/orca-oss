/** How long a lead's send to a remote member waits for its host to take the mail (ORCA-1301). */
export const RELAY_DELIVERY_WAIT_MS = 5_000
const POLL_MS = 200

/** When the host took the item, or null once the wait ends without it. */
export async function waitForRelayDelivery(
  ackedAt: () => string | null | undefined,
  timeoutMs = RELAY_DELIVERY_WAIT_MS
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const at = ackedAt()
    if (at) {
      return at
    }
    if (Date.now() >= deadline) {
      return null
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
}

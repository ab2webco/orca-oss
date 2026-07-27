export const CLAUDE_LAUNCH_RESERVATION_TTL_MS = 5 * 60 * 1000

const expiryTimers = new Map<string, NodeJS.Timeout>()

export function scheduleClaudeLaunchReservationExpiry(
  reservationId: string,
  release: (reservationId: string) => void
): void {
  // Why: five minutes tolerates slow SSH/WSL startup while bounding leaked failed launches.
  const timer = setTimeout(() => release(reservationId), CLAUDE_LAUNCH_RESERVATION_TTL_MS)
  timer.unref()
  expiryTimers.set(reservationId, timer)
}

export function clearClaudeLaunchReservationExpiry(reservationId: string): void {
  const timer = expiryTimers.get(reservationId)
  if (timer) {
    clearTimeout(timer)
    expiryTimers.delete(reservationId)
  }
}

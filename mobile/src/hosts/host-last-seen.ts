/** "last seen 14:02" in the phone's local time; null when the phone never connected to the host. */
export function hostLastSeenLabel(lastConnected: number | undefined): string | null {
  if (!lastConnected) {
    return null
  }
  const at = new Date(lastConnected)
  const hh = String(at.getHours()).padStart(2, '0')
  const mm = String(at.getMinutes()).padStart(2, '0')
  return `last seen ${hh}:${mm}`
}

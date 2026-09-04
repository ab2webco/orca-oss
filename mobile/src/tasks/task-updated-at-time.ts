export function taskTime(value: string): number {
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : 0
}

export function formatUpdatedAt(value: string): string {
  const time = taskTime(value)
  if (!time) {
    return ''
  }
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60_000))
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours}h`
  }
  return `${Math.floor(hours / 24)}d`
}

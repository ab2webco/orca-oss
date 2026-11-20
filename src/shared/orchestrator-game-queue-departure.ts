/** What GitHub says of a PR read when the lead's watch saw it leave the merge queue (ORCA-1273). */
export type GameQueueDeparture = {
  state: 'open' | 'merged' | 'closed'
  /** The last RemovedFromMergeQueueEvent's reason, such as `merged` or `failed_checks`. */
  reason: string | null
  /** Who removed it; the queue's own bot when no person did. */
  actor: string | null
}

export const MERGE_QUEUE_BOT = 'github-merge-queue'

export function queueDepartureLineOf(id: string, departure: GameQueueDeparture): string {
  if (departure.state === 'merged' || departure.reason === 'merged') {
    return `${id} merged from the queue: close its ticket and clean up its member.`
  }
  if (departure.state === 'closed') {
    return `${id} closed while in the merge queue: check why before its member moves on.`
  }
  if (departure.actor && departure.actor !== MERGE_QUEUE_BOT) {
    return `${id} dequeued by ${departure.actor}: queue it again only when that is settled.`
  }
  const why = departure.reason ? ` (${departure.reason})` : ''
  return `${id} dropped from the merge queue${why}: find why, then fix it or queue it again.`
}

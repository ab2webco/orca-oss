/** What GitHub says of a PR read when the lead's watch saw it leave the merge queue (ORCA-1273). */
export type GameQueueDeparture = {
  state: 'open' | 'merged' | 'closed'
  /** The last RemovedFromMergeQueueEvent's reason, such as `merged` or `failed_checks`. */
  reason: string | null
  /** Who removed it; the queue's own bot when no person did. */
  actor: string | null
  /** The checks that failed on the merge-group commit the removal names; absent from older hosts. */
  failedChecks?: GameQueueFailedCheck[]
}

export type GameQueueFailedCheck = { name: string; runId: number | null }

export const MERGE_QUEUE_BOT = 'github-merge-queue'

const FAILED_CHECKS_SHOWN = 3

function failedChecksOf(checks: readonly GameQueueFailedCheck[]): string {
  const names = checks.slice(0, FAILED_CHECKS_SHOWN).map((one) => one.name)
  const more = checks.length - names.length
  const runs = [...new Set(checks.flatMap((one) => (one.runId === null ? [] : [one.runId])))]
  return `${names.join(', ')}${more > 0 ? ` and ${more} more` : ''}${
    runs.length > 0 ? `; run ${runs.join(', ')}` : ''
  }`
}

/** Unread or unrecorded: the watch cannot tell a merge from a drop, so it says neither (ORCA-1103). */
export const unprovenQueueDepartureLineOf = (id: string): string =>
  `${id} left the merge queue and GitHub's reason was not read: check whether it merged (gh pr view ${id.replace('#', '')}).`

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
  if (!departure.reason) {
    return unprovenQueueDepartureLineOf(id)
  }
  const failed = departure.failedChecks?.length ? `: ${failedChecksOf(departure.failedChecks)}` : ''
  return `${id} dropped from the merge queue (${departure.reason}${failed}): find why, then fix it or queue it again.`
}

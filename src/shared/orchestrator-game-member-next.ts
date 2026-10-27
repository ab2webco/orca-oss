import type { GameAgent } from './orchestrator-game-state'

export function idleNextOf(review: GameAgent['review']): string {
  if (!review) {
    return 'push'
  }
  if (review.state === 'merged') {
    return 'move the ticket to review'
  }
  if (review.state === 'closed') {
    return `check: PR #${review.number} closed`
  }
  if (review.ci === 'failure') {
    return 'push: CI failing'
  }
  return review.ci === 'pending' ? 'wait for CI' : `review PR #${review.number}`
}

/** A remote member whose host does not answer: its home dispatch is what the lead can still read (ORCA-824). */
export const silentHostNextOf = (host: string, paneKey: string): string =>
  `${host} does not answer: orca orchestration worker-show --dispatch ${paneKey.replace(/^remote:/, '')}`

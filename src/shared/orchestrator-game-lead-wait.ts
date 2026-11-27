import { GAME_OWNER_HANDLE, type GameWaitingMessage } from './orchestrator-game-inbox'

/** Minutes a member's question, escalation or decision gate waits on the lead before the watch alerts. */
export const GAME_LEAD_REPLY_ALERT_MINUTES = 10

// Why: inbox times are SQLite's datetime('now'), UTC with no zone, which Date.parse reads as local.
const ZONELESS = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/

export function waitStartMsOf(at: string): number {
  return Date.parse(ZONELESS.test(at) ? `${at.replace(' ', 'T')}Z` : at)
}

/** `12m`, or `3h22m` past the hour; null for a time it cannot read. */
export function waitAgeLabelOf(at: string, now: number): string | null {
  const ms = now - waitStartMsOf(at)
  if (!Number.isFinite(ms)) {
    return null
  }
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${minutes % 60}m`
}

/** The fleet's NEXT for a member whose question waits on the lead, with how long it has (ORCA-1154). */
export function waitingOnYouNextOf(question: GameWaitingMessage, now = Date.now()): string {
  const age = waitAgeLabelOf(question.at, now)
  return `waiting on you${age ? ` ${age}` : ''}: orchestration reply --id ${question.id}`
}

// Why the evidence: the lead can tell a missed reply from a watch that misread it (ORCA-1431).
function waitLineOf(wait: GameWaitingMessage, age: string | null): string {
  if (wait.from === GAME_OWNER_HANDLE) {
    return `owner answer unread ${age}, no reply threads it: "${wait.subject}". Act on it, then ack its delivery or reply: orca orchestration reply --id ${wait.id}`
  }
  return `${wait.from} waiting on you ${age}, no reply threads it: "${wait.subject}". Answer it: orca orchestration reply --id ${wait.id}`
}

/**
 * One alert per wait past the budget, keyed by its doubling step so it prints again at 2x, 4x, ...
 * the budget until the lead replies (ORCA-1154). Folded into ORCA-1301.
 */
export function leadWaitAlertsOf(
  waiting: readonly GameWaitingMessage[],
  budgetMinutes: number,
  now: number
): { key: string; line: string }[] {
  const budgetMs = budgetMinutes * 60_000
  return waiting.flatMap((wait) => {
    const ms = now - waitStartMsOf(wait.at)
    if (!(ms >= budgetMs)) {
      return []
    }
    const step = Math.floor(Math.log2(ms / budgetMs))
    return [
      {
        key: `lead-wait:${wait.id}:${step}`,
        line: waitLineOf(wait, waitAgeLabelOf(wait.at, now))
      }
    ]
  })
}

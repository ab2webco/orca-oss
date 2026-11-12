import { isReviewSettled } from './orchestrator-game-characters'
import type { GameHistoryRecord } from './orchestrator-game-history'

/** A freed member's PR that was still open, and the character its merge would pay. */
export type GameLateReviewCheck = {
  ticket: string
  number: number
  branch: string
  /** The repo's display name the record kept; null when its host did not fill it in. */
  repo: string | null
  character: { key: string; name: string }
}

// Why 20: a project's recent frees; each check is a cached review read.
export const GAME_LATE_REVIEW_MAX = 20

const OPEN_PR = /^#(\d+) (?:open|draft)$/

/**
 * The newest freed records whose PR was open when the member left and that no merge paid or
 * close settled since, one per PR (ORCA-1170). `keyOf` gives a shown name's roster key.
 */
export function lateReviewChecksOf(
  records: readonly GameHistoryRecord[],
  stored: Record<string, unknown>,
  keyOf: (name: string) => string,
  max = GAME_LATE_REVIEW_MAX
): GameLateReviewCheck[] {
  const checks: GameLateReviewCheck[] = []
  const seen = new Set<string>()
  for (const record of records.toReversed()) {
    const number = Number(OPEN_PR.exec(record.pr ?? '')?.[1] ?? Number.NaN)
    const name = record.character?.trim()
    const { ticket, branch } = record
    if (!ticket || !branch || !name || !Number.isInteger(number)) {
      continue
    }
    const key = keyOf(name)
    const review = { ticket, number }
    if (seen.has(`${ticket}#${number}`) || isReviewSettled(stored, key, review)) {
      continue
    }
    seen.add(`${ticket}#${number}`)
    checks.push({ ...review, branch, repo: record.repo, character: { key, name } })
    if (checks.length === max) {
      break
    }
  }
  return checks
}

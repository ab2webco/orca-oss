import type { GameHistoryRecord } from '../../shared/orchestrator-game-history'

// Why 14 days: a freed worktree waits for its merge; past that it is no longer the team's to show.
export const FREED_MEMBER_NEST_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

export type FreedMemberNest = { memberWorktreeId: string; leadWorktreeId: string }

/** The freed members to nest under their lead: the latest record per worktree, recent, both ends present. */
export function freedMembersToNest(
  records: readonly GameHistoryRecord[],
  now: number,
  worktreeExists: (worktreeId: string) => boolean
): FreedMemberNest[] {
  const latest = new Map<string, GameHistoryRecord>()
  for (const record of records) {
    const previous = record.worktreeId ? latest.get(record.worktreeId) : undefined
    if (record.worktreeId && (!previous || previous.endedAt <= record.endedAt)) {
      latest.set(record.worktreeId, record)
    }
  }
  const nests: FreedMemberNest[] = []
  for (const [memberWorktreeId, record] of latest) {
    const lead = record.leadWorktreeId
    if (
      lead &&
      lead !== memberWorktreeId &&
      now - Date.parse(record.endedAt) <= FREED_MEMBER_NEST_WINDOW_MS &&
      worktreeExists(memberWorktreeId) &&
      worktreeExists(lead)
    ) {
      nests.push({ memberWorktreeId, leadWorktreeId: lead })
    }
  }
  return nests
}

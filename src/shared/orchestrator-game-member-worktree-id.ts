/**
 * A worktree id is `<repoId>::<absolute path>` and can pass the 200 characters an older Orca's
 * members parser accepts per field (ORCA-1119). Such an id is saved whole in `fullWorktreeId`, and
 * `worktreeId` holds a marked stand-in short enough for that parser, so the file stays readable.
 */
// Why a bound: no patch may make the saved file unbounded; well past any OS path limit.
export const WORKTREE_ID_MAX = 4096
const MARK = '…'

export const worktreeIdStandIn = (id: string, max: number): string =>
  id.length <= max ? id : `${id.slice(0, max - 1)}${MARK}`

/**
 * The whole id when `worktreeId` is still its stand-in. Why the mark and not a prefix match: an older
 * Orca clips plainly, and two worktrees in one deep folder share their first 200 characters.
 */
export function savedWorktreeId(
  worktreeId: string | null,
  full: unknown,
  max: number
): string | null {
  return typeof full === 'string' &&
    full.length > max &&
    full.length <= WORKTREE_ID_MAX &&
    worktreeId === worktreeIdStandIn(full, max)
    ? full
    : worktreeId
}

/** The fields to save for an id: a short one as it is, a long one as its stand-in plus the whole. */
export const savedWorktreeIdFields = (
  worktreeId: string | null,
  max: number
): { worktreeId: string | null; fullWorktreeId?: string } =>
  worktreeId === null || worktreeId.length <= max
    ? { worktreeId }
    : { worktreeId: worktreeIdStandIn(worktreeId, max), fullWorktreeId: worktreeId }

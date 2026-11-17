/**
 * One `gh pr view` per PR version for every consumer polling it (ORCA-1213).
 *
 * Why: GraphQL has no ETags, and the sidebar, the panel and the game each hydrate the
 * same branch PR; the key carries the PR's updatedAt and head, so a push, edit or merge
 * reads fresh, and only CI that settles without touching the PR waits out the window.
 */
import { ACTIVE_REFRESH_INTERVAL_MS } from '../source-control/hosted-review-refresh-pacing'

// Why: the selected worktree, the freshest tier any surface polls, already re-reads once a minute.
const PR_VIEW_SHARE_MS = ACTIVE_REFRESH_INTERVAL_MS
const MAX_ENTRIES = 512

const shared = new Map<string, { value: Promise<unknown>; expiresAt: number }>()

function prune(now: number): void {
  for (const [key, entry] of shared) {
    if (entry.expiresAt <= now) {
      shared.delete(key)
    }
  }
  while (shared.size > MAX_ENTRIES) {
    const oldest = shared.keys().next().value
    if (oldest === undefined) {
      return
    }
    shared.delete(oldest)
  }
}

export function sharePRView<T>(key: string, read: () => Promise<T>, fresh = false): Promise<T> {
  const now = Date.now()
  prune(now)
  const entry = shared.get(key)
  if (entry && !fresh) {
    return entry.value as Promise<T>
  }
  const value = read()
  shared.set(key, { value, expiresAt: now + PR_VIEW_SHARE_MS })
  // Why: a failed read is shared only while in flight; the next poll asks again.
  value.catch(() => {
    if (shared.get(key)?.value === value) {
      shared.delete(key)
    }
  })
  return value
}

/** @internal - test-only */
export function _resetPRViewShareForTests(): void {
  shared.clear()
}

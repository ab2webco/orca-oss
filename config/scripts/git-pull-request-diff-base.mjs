import { execFileSync } from 'node:child_process'
import process from 'node:process'
import { resolveChangedCodeBase } from './resolve-changed-code-base.mjs'

const DEFAULT_UPSTREAM_REF = 'upstream/main'

/**
 * Why the first parent wins: `github.event.pull_request.base.sha` describes the
 * event, not the tree that was checked out, and the two drift. The ephemeral
 * `refs/pull/N/merge` commit carries the base it was actually built from, so a
 * requested base is never trusted over it.
 *
 * `resolveSyncBase` is the one thing allowed past that, and it does not weaken
 * the rule: it is handed the first parent and may only widen to the upstream
 * frontier that same parent's history already reaches. It never sees the
 * requested base, so a caller still cannot name its own measuring point.
 */
export function selectPullRequestDiffBase(
  requestedBase,
  headParents,
  eventName,
  resolveSyncBase = null
) {
  if (eventName === 'pull_request' && headParents.length >= 2) {
    const checkoutBase = headParents[0]
    return resolveSyncBase ? (resolveSyncBase(checkoutBase) ?? checkoutBase) : checkoutBase
  }
  return requestedBase
}

/**
 * Opt-in, not automatic. Both changed-line gates now pass it — React Doctor to
 * stop billing the fork for upstream's debt (ORCA-202), the code-quality gate to
 * stop hiding the fork's own lines behind the pre-sync tip (ORCA-205) — but the
 * default is what keeps every other caller, and every non-`pull_request` event,
 * on the stricter PR base. A gate opts in once it has dealt with the findings
 * the wider base surfaces; a shared default would decide that for all of them.
 */
export function resolvePullRequestDiffBase(
  root,
  requestedBase,
  eventName = process.env.GITHUB_EVENT_NAME,
  { syncAware = false } = {}
) {
  const [, ...headParents] = execFileSync('git', ['rev-list', '--parents', '-n', '1', 'HEAD'], {
    cwd: root,
    encoding: 'utf8'
  })
    .trim()
    .split(/\s+/)
  return selectPullRequestDiffBase(
    requestedBase,
    headParents,
    eventName,
    syncAware
      ? (checkoutBase) => resolveChangedCodeBase(checkoutBase, DEFAULT_UPSTREAM_REF, root)
      : null
  )
}

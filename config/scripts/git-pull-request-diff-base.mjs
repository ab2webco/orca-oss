import { execFileSync } from 'node:child_process'
import process from 'node:process'

/**
 * Why the first parent wins: `github.event.pull_request.base.sha` describes the
 * event, not the tree that was checked out, and the two drift. The ephemeral
 * `refs/pull/N/merge` commit carries the base it was actually built from, so a
 * requested base is never trusted over it.
 */
export function selectPullRequestDiffBase(requestedBase, headParents, eventName) {
  if (eventName === 'pull_request' && headParents.length >= 2) {
    return headParents[0]
  }
  return requestedBase
}

export function resolvePullRequestDiffBase(
  root,
  requestedBase,
  eventName = process.env.GITHUB_EVENT_NAME
) {
  const [, ...headParents] = execFileSync('git', ['rev-list', '--parents', '-n', '1', 'HEAD'], {
    cwd: root,
    encoding: 'utf8'
  })
    .trim()
    .split(/\s+/)
  return selectPullRequestDiffBase(requestedBase, headParents, eventName)
}

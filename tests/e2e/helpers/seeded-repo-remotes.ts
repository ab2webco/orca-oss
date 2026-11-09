/**
 * Every spec in a worker shares one seeded repo, so a spec that points it at a remote changes how
 * the next one reads it (ORCA-1148). The Electron fixture snapshots the remotes before each test
 * and puts them back after.
 */

import { execFileSync } from 'node:child_process'

/** Each remote's config entries, `[key, value]` in config order, by remote name. */
export type RepoRemotes = Record<string, [string, string][]>

function git(repoPath: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repoPath, encoding: 'utf8', stdio: 'pipe' })
}

export function snapshotRepoRemotes(repoPath: string): RepoRemotes {
  let listed = ''
  try {
    listed = git(repoPath, ['config', '--local', '--get-regexp', '^remote\\.'])
  } catch {
    // Why: --get-regexp exits 1 when nothing matches, which is a repo with no remotes.
    return {}
  }
  const remotes: RepoRemotes = {}
  for (const line of listed.split('\n').filter(Boolean)) {
    const space = line.indexOf(' ')
    const key = space === -1 ? line : line.slice(0, space)
    const value = space === -1 ? '' : line.slice(space + 1)
    // Why lastIndexOf: a remote's name can itself hold dots.
    const name = key.slice('remote.'.length, key.lastIndexOf('.'))
    ;(remotes[name] ??= []).push([key, value])
  }
  return remotes
}

const sameEntries = (a: [string, string][] | undefined, b: [string, string][] | undefined) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

export function restoreRepoRemotes(repoPath: string, before: RepoRemotes): void {
  const now = snapshotRepoRemotes(repoPath)
  for (const name of Object.keys(now)) {
    if (!sameEntries(now[name], before[name])) {
      // Why remove: it also drops the remote's tracking refs and branch upstreams the test set.
      git(repoPath, ['remote', 'remove', name])
    }
  }
  for (const [name, entries] of Object.entries(before)) {
    if (!sameEntries(now[name], entries)) {
      for (const [key, value] of entries) {
        git(repoPath, ['config', '--local', '--add', key, value])
      }
    }
  }
}

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { restoreRepoRemotes, snapshotRepoRemotes } from './seeded-repo-remotes'

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' })
// Why sorted: a remote put back is appended, so `git remote -v` can list it in another order.
const remotesOf = (cwd: string): string => git(cwd, 'remote', '-v').split('\n').sort().join('\n')

// ORCA-1148: team-panel-queue-machines-advisor left origin on github.com/acme/repo in the seeded
// repo every spec of a shard shares, so worktree.spec's pasted stablyai/orca URL never resolved.
describe('seeded repo remotes', () => {
  let repo = ''
  beforeEach(() => {
    repo = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-remotes-'))
    git(repo, 'init', '-q')
  })
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  it('removes the remotes a test added to a repo that had none', () => {
    const before = snapshotRepoRemotes(repo)
    git(repo, 'remote', 'add', 'origin', 'https://github.com/acme/repo.git')
    git(repo, 'config', 'remote.upstream.url', 'https://github.com/acme/repo.git')
    restoreRepoRemotes(repo, before)
    expect(remotesOf(repo)).toBe('')
  })

  it('puts back a remote a test changed or removed', () => {
    git(repo, 'remote', 'add', 'origin', '/srv/scratch/origin.git')
    git(repo, 'remote', 'add', 'fork', '/srv/scratch/fork.git')
    const expected = remotesOf(repo)
    const before = snapshotRepoRemotes(repo)
    git(repo, 'remote', 'set-url', 'origin', 'https://github.com/acme/repo.git')
    git(repo, 'remote', 'remove', 'fork')
    restoreRepoRemotes(repo, before)
    expect(remotesOf(repo)).toBe(expected)
  })

  it('leaves the repo alone when its remotes did not change', () => {
    git(repo, 'remote', 'add', 'origin', '/srv/scratch/origin.git')
    git(
      repo,
      '-c',
      'user.name=e2e',
      '-c',
      'user.email=e2e@test.local',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'seed'
    )
    git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
    const before = snapshotRepoRemotes(repo)
    restoreRepoRemotes(repo, before)
    expect(git(repo, 'for-each-ref', 'refs/remotes')).toContain('refs/remotes/origin/main')
  })
})

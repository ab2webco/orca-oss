import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSetupRunnerScript } from './worktree-runner-script'
import { withoutRepoLocalGitEnv } from './git/repo-local-git-env'
import { makeHookTestRepo } from './hooks-test-fixtures'

const gitEnv = {
  ...withoutRepoLocalGitEnv(process.env),
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.com'
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf-8' }).trim()
}

function createRepoWithWorktree(root: string, name: string): { repo: string; worktree: string } {
  const repo = join(root, name)
  const worktree = join(root, `${name}-wt`)
  execFileSync('git', ['init', '-q', repo], { env: gitEnv })
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'init')
  git(repo, 'worktree', 'add', '-q', worktree)
  return { repo, worktree }
}

describe('createSetupRunnerScript with an inherited GIT_DIR (ORCA-978)', () => {
  let root: string
  const previousGitDir = process.env.GIT_DIR

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'orca-runner-git-env-')))
  })

  afterEach(() => {
    if (previousGitDir === undefined) {
      delete process.env.GIT_DIR
    } else {
      process.env.GIT_DIR = previousGitDir
    }
    rmSync(root, { recursive: true, force: true })
  })

  it("writes the runner into the worktree's own gitdir, not the inherited repo's", () => {
    const other = createRepoWithWorktree(root, 'other')
    const own = createRepoWithWorktree(root, 'own')
    const ownGitDir = git(own.worktree, 'rev-parse', '--absolute-git-dir')
    process.env.GIT_DIR = git(other.worktree, 'rev-parse', '--absolute-git-dir')

    const launch = createSetupRunnerScript(
      { ...makeHookTestRepo(), path: own.repo },
      own.worktree,
      'echo ok'
    )
    // The inherited repo's worktree goes away, as in the report.
    delete process.env.GIT_DIR
    git(other.repo, 'worktree', 'remove', '--force', other.worktree)

    expect(realpathSync(launch.runnerScriptPath).startsWith(`${ownGitDir}`)).toBe(true)
    expect(readFileSync(launch.runnerScriptPath, 'utf-8')).toContain('echo ok')
    expect(existsSync(join(root, 'other', '.git', 'worktrees', 'other-wt'))).toBe(false)
  })
})

describe('withoutRepoLocalGitEnv', () => {
  it('drops repository-pinning vars in any case and keeps the rest', () => {
    expect(
      withoutRepoLocalGitEnv({
        GIT_DIR: '/a/.git',
        Git_Work_Tree: '/a',
        GIT_COMMON_DIR: '/a/.git',
        GIT_CONFIG_COUNT: '1',
        PATH: '/usr/bin'
      })
    ).toEqual({ GIT_CONFIG_COUNT: '1', PATH: '/usr/bin' })
  })
})

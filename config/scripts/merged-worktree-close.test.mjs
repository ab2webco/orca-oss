import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { deleteRemoteBranch, parseWorktreeList } from './merged-worktree-close.mjs'

const script = resolve(import.meta.dirname, 'merged-worktree-close.mjs')
const tempDirs = []

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200
    })
  }
})

describe('deleteRemoteBranch', () => {
  it('deletes the remote branch only while it still points at the merged head', () => {
    const { repo, origin, addFeature } = makeRepo()
    const feature = addFeature('fix/a')
    git(feature.path, 'commit', '-q', '--allow-empty', '-m', 'late')
    git(feature.path, 'push', '-q', 'origin', 'fix/a')

    expect(deleteRemoteBranch(repo, 'origin', 'fix/a', feature.head).ok).toBe(false)
    expect(git(origin, 'branch', '--list', 'fix/a')).not.toBe('')

    const moved = git(feature.path, 'rev-parse', 'HEAD')
    expect(deleteRemoteBranch(repo, 'origin', 'fix/a', moved).ok).toBe(true)
    expect(git(origin, 'branch', '--list', 'fix/a')).toBe('')
  })
})

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.com'
    }
  }).trim()
}

/** A clone of a bare origin with one pushed feature branch checked out in a worktree. */
function makeRepo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orca-wt-close-')))
  tempDirs.push(root)
  const origin = join(root, 'origin.git')
  const repo = join(root, 'repo')
  git(root, 'init', '--bare', '-q', '-b', 'main', origin)
  git(root, 'clone', '-q', origin, repo)
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'base')
  git(repo, 'push', '-q', 'origin', 'HEAD:main')
  const addFeature = (branch) => {
    const path = join(root, branch.replaceAll('/', '-'))
    git(repo, 'worktree', 'add', '-q', '-b', branch, path)
    writeFileSync(join(path, 'work.txt'), branch)
    git(path, 'add', 'work.txt')
    git(path, 'commit', '-q', '-m', branch)
    git(path, 'push', '-q', '-u', 'origin', branch)
    return { path, head: git(path, 'rev-parse', 'HEAD') }
  }
  return { root, origin, repo, addFeature }
}

function cliEnv() {
  const env = { ...process.env }
  // Why: inside an Orca terminal the closer would ask the real Orca app for its terminals.
  delete env.ORCA_TERMINAL_HANDLE
  delete env.ORCA_CLI_COMMAND
  return env
}

function writeJson(dir, value) {
  const file = join(dir, `data-${Math.random().toString(36).slice(2)}.json`)
  writeFileSync(file, JSON.stringify(value))
  return file
}

function runCli(cwd, prs, ...args) {
  return runScript(script, cwd, ['--merged-prs-file', writeJson(join(cwd, '..'), prs), ...args])
}

function runScript(path, cwd, args) {
  return spawnSync('node', [path, '--remover', 'git', ...args], {
    cwd,
    encoding: 'utf8',
    env: cliEnv()
  })
}

describe('merged-worktree-close CLI', () => {
  it('parses the worktrees git reports, primary first', () => {
    const { repo, addFeature } = makeRepo()
    const feature = addFeature('fix/a')
    const worktrees = parseWorktreeList(git(repo, 'worktree', 'list', '--porcelain'))
    expect(worktrees).toEqual([
      {
        path: repo,
        head: git(repo, 'rev-parse', 'HEAD'),
        branch: 'main',
        isPrimary: true,
        prunable: false
      },
      {
        path: feature.path,
        head: feature.head,
        branch: 'fix/a',
        isPrimary: false,
        prunable: false
      }
    ])
  })

  it('removes the merged worktree and deletes its local and remote branch', () => {
    const { repo, origin, addFeature } = makeRepo()
    const feature = addFeature('fix/a')

    const result = runCli(repo, {
      'fix/a': [{ number: 12, headRefOid: feature.head }]
    })

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain(`closed fix/a (#12) ${feature.path}`)
    expect(existsSync(feature.path)).toBe(false)
    expect(git(repo, 'branch', '--list', 'fix/a')).toBe('')
    expect(git(origin, 'branch', '--list', 'fix/a')).toBe('')
  })

  it('never touches a merged worktree with uncommitted work, and the gate fails on it', () => {
    const { repo, origin, addFeature } = makeRepo()
    const feature = addFeature('fix/a')
    writeFileSync(join(feature.path, 'draft.txt'), 'unsaved')

    const result = runCli(repo, { 'fix/a': [{ number: 12, headRefOid: feature.head }] }, '--gate')

    expect(result.status).toBe(1)
    expect(result.stdout).toContain('kept fix/a (#12): uncommitted changes')
    expect(existsSync(join(feature.path, 'draft.txt'))).toBe(true)
    expect(git(repo, 'branch', '--list', 'fix/a')).not.toBe('')
    expect(git(origin, 'branch', '--list', 'fix/a')).not.toBe('')
  })

  it('keeps the remote branch when someone pushed to it after the merge', () => {
    const { root, repo, origin, addFeature } = makeRepo()
    const feature = addFeature('fix/a')
    const other = join(root, 'other')
    git(root, 'clone', '-q', '-b', 'fix/a', origin, other)
    git(other, 'commit', '-q', '--allow-empty', '-m', 'late')
    git(other, 'push', '-q', 'origin', 'fix/a')

    const result = runCli(repo, {
      'fix/a': [{ number: 12, headRefOid: feature.head }]
    })

    expect(result.status, result.stderr).toBe(0)
    expect(existsSync(feature.path)).toBe(false)
    expect(git(origin, 'branch', '--list', 'fix/a')).not.toBe('')
    expect(result.stdout).toContain('remote fix/a moved after the merge; left on origin')
  })

  it('never removes the worktree a --skip-path points into, and the gate counts it as open', () => {
    const { repo, origin, addFeature } = makeRepo()
    const feature = addFeature('fix/a')
    const sessionDir = join(feature.path, 'src')
    mkdirSync(sessionDir)

    const result = runCli(
      repo,
      { 'fix/a': [{ number: 12, headRefOid: feature.head }] },
      '--gate',
      '--skip-path',
      sessionDir
    )

    expect(result.status, result.stderr).toBe(1)
    expect(result.stdout).toContain(`kept fix/a (#12): this session runs inside it ${feature.path}`)
    expect(existsSync(feature.path)).toBe(true)
    expect(git(origin, 'branch', '--list', 'fix/a')).not.toBe('')
  })

  it('never removes the worktree it runs from, even without --skip-path', () => {
    const { addFeature } = makeRepo()
    const feature = addFeature('fix/a')

    const result = runCli(feature.path, { 'fix/a': [{ number: 12, headRefOid: feature.head }] })

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain(`kept fix/a (#12): this session runs inside it ${feature.path}`)
    expect(existsSync(feature.path)).toBe(true)
  })

  it('counts untracked files as changes even when status hides them', () => {
    const { repo, addFeature } = makeRepo()
    const feature = addFeature('fix/a')
    git(repo, 'config', 'status.showUntrackedFiles', 'no')
    writeFileSync(join(feature.path, 'draft.txt'), 'unsaved')

    const result = runCli(repo, { 'fix/a': [{ number: 12, headRefOid: feature.head }] })

    expect(result.stdout).toContain('kept fix/a (#12): uncommitted changes')
    expect(existsSync(join(feature.path, 'draft.txt'))).toBe(true)
  })

  it('keeps a worktree with commits after its merged head, and the gate fails on it', () => {
    const { repo, addFeature } = makeRepo()
    const feature = addFeature('fix/a')
    git(feature.path, 'commit', '-q', '--allow-empty', '-m', 'after merge')

    const result = runCli(repo, { 'fix/a': [{ number: 12, headRefOid: feature.head }] }, '--gate')

    expect(result.status).toBe(1)
    expect(result.stdout).toContain('kept fix/a (#12): commits after the merged head of #12')
    expect(existsSync(feature.path)).toBe(true)
  })

  it('ignores a reused branch name unrelated to its merged PR, and the gate passes', () => {
    const { repo, addFeature } = makeRepo()
    const feature = addFeature('fix/a')
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'unrelated')
    const unrelated = git(repo, 'rev-parse', 'HEAD')

    const result = runCli(repo, { 'fix/a': [{ number: 12, headRefOid: unrelated }] }, '--gate')

    expect(result.status, result.stdout).toBe(0)
    expect(result.stdout).not.toContain('fix/a')
    expect(existsSync(feature.path)).toBe(true)
  })

  /** Pushes a commit to fix/a from a second clone, as a reviewer would, and returns its sha. */
  function pushFromSecondClone(root, origin) {
    const other = join(root, 'other')
    git(root, 'clone', '-q', '-b', 'fix/a', origin, other)
    git(other, 'commit', '-q', '--allow-empty', '-m', 'review fix')
    git(other, 'push', '-q', 'origin', 'fix/a')
    return git(other, 'rev-parse', 'HEAD')
  }

  it('closes a clean worktree behind its merged head, and the gate passes', () => {
    const { root, repo, origin, addFeature } = makeRepo()
    const feature = addFeature('fix/a')
    const mergedHead = pushFromSecondClone(root, origin)
    git(repo, 'fetch', '-q', 'origin')

    const result = runCli(repo, { 'fix/a': [{ number: 12, headRefOid: mergedHead }] }, '--gate')

    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(result.stdout).toContain(`closed fix/a (#12) ${feature.path}`)
    expect(existsSync(feature.path)).toBe(false)
    expect(git(origin, 'branch', '--list', 'fix/a')).toBe('')
  })

  it('fetches a merged head missing locally from the PR ref, creating no refs', () => {
    const { root, repo, origin, addFeature } = makeRepo()
    const feature = addFeature('fix/a')
    const mergedHead = pushFromSecondClone(root, origin)
    // Why: GitHub keeps every PR head under refs/pull/<N>/head.
    git(origin, 'update-ref', 'refs/pull/12/head', mergedHead)

    const result = runCli(repo, { 'fix/a': [{ number: 12, headRefOid: mergedHead }] }, '--gate')

    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(result.stdout).toContain(`closed fix/a (#12) ${feature.path}`)
    expect(git(repo, 'for-each-ref', '--format=%(refname)', 'refs/pull')).toBe('')
  })

  it('under --gate reports a merged head it cannot get as unverified', () => {
    const { repo, addFeature } = makeRepo()
    const feature = addFeature('fix/a')
    const prs = { 'fix/a': [{ number: 12, headRefOid: 'e'.repeat(40) }] }

    const gated = runCli(repo, prs, '--gate')
    const plain = runCli(repo, prs)

    expect(gated.status, gated.stderr).toBe(1)
    expect(gated.stdout).toContain('unverified fix/a: merged head of #12 not available locally')
    expect(plain.status, plain.stderr).toBe(0)
    expect(plain.stdout).toBe('')
    expect(existsSync(feature.path)).toBe(true)
  })

  it('under --gate turns branches left unchecked by the time budget into unverified', () => {
    const { repo, addFeature } = makeRepo()
    const feature = addFeature('fix/a')
    const prs = { 'fix/a': [{ number: 12, headRefOid: feature.head }] }

    const gated = runCli(repo, prs, '--gate', '--budget-ms', '1')
    const plain = runCli(repo, prs, '--budget-ms', '1')

    expect(gated.status, gated.stderr).toBe(1)
    expect(gated.stdout).toContain('unverified fix/a: time budget exhausted')
    expect(plain.status, plain.stderr).toBe(0)
    expect(existsSync(feature.path)).toBe(true)
  })

  it('keeps every merged worktree when the Orca terminals cannot be read', () => {
    const { root, repo, addFeature } = makeRepo()
    const feature = addFeature('fix/a')
    const terminals = join(root, 'terminals.json')
    writeFileSync(terminals, 'not json')

    const result = runCli(
      repo,
      { 'fix/a': [{ number: 12, headRefOid: feature.head }] },
      '--gate',
      '--terminals-file',
      terminals
    )

    expect(result.status, result.stderr).toBe(1)
    expect(result.stdout).toMatch(
      new RegExp(
        `^kept fix/a \\(#12\\): could not read Orca terminals \\(.+\\) ${feature.path}$`,
        'm'
      )
    )
    expect(existsSync(feature.path)).toBe(true)
  })

  it('keeps a merged worktree with a terminal active in the last 10 minutes', () => {
    const { root, repo, origin, addFeature } = makeRepo()
    const feature = addFeature('fix/a')
    const terminals = writeJson(root, [
      {
        worktreePath: join(feature.path, '.'),
        liveness: 'running',
        lastOutputAt: Date.now() - 2 * 60_000
      }
    ])

    const result = runCli(
      repo,
      { 'fix/a': [{ number: 12, headRefOid: feature.head }] },
      '--gate',
      '--terminals-file',
      terminals
    )

    expect(result.status, result.stderr).toBe(1)
    expect(result.stdout).toContain(
      `kept fix/a (#12): a terminal in it was active 2 min ago ${feature.path}`
    )
    expect(existsSync(feature.path)).toBe(true)
    expect(git(origin, 'branch', '--list', 'fix/a')).not.toBe('')
  })

  it('closes a merged worktree whose terminal has been idle for 30 minutes', () => {
    const { root, repo, addFeature } = makeRepo()
    const feature = addFeature('fix/a')
    const terminals = writeJson(root, [
      { worktreePath: feature.path, liveness: 'running', lastOutputAt: Date.now() - 30 * 60_000 }
    ])

    const result = runCli(
      repo,
      { 'fix/a': [{ number: 12, headRefOid: feature.head }] },
      '--terminals-file',
      terminals
    )

    expect(result.stdout).toContain(`closed fix/a (#12) ${feature.path}`)
    expect(existsSync(feature.path)).toBe(false)
  })

  it('closes a merged worktree when the active terminal lives in another worktree', () => {
    const { root, repo, addFeature } = makeRepo()
    const feature = addFeature('fix/a')
    const other = addFeature('fix/b')
    const terminals = writeJson(root, [
      { worktreePath: other.path, liveness: 'running', lastOutputAt: Date.now() }
    ])

    const result = runCli(
      repo,
      { 'fix/a': [{ number: 12, headRefOid: feature.head }] },
      '--terminals-file',
      terminals
    )

    expect(result.stdout).toContain(`closed fix/a (#12) ${feature.path}`)
    expect(existsSync(feature.path)).toBe(false)
    expect(existsSync(other.path)).toBe(true)
  })

  it('says so in one line when the remote branch could not be deleted', () => {
    const { repo, origin, addFeature } = makeRepo()
    const feature = addFeature('fix/a')
    const hook = join(origin, 'hooks', 'pre-receive')
    writeFileSync(hook, '#!/bin/sh\necho "deletes are refused here" >&2\nexit 1\n')
    chmodSync(hook, 0o755)

    const result = runCli(repo, { 'fix/a': [{ number: 12, headRefOid: feature.head }] })

    expect(result.status, result.stderr).toBe(0)
    const line = result.stdout.split('\n').find((l) => l.startsWith('closed fix/a'))
    expect(line).toMatch(
      new RegExp(`^closed fix/a \\(#12\\) ${feature.path}; remote branch not deleted: .*refused`)
    )
    expect(existsSync(feature.path)).toBe(false)
    expect(git(origin, 'branch', '--list', 'fix/a')).not.toBe('')
  })

  it('under --gate fails closed when it cannot read a branch PRs', () => {
    const { repo, addFeature } = makeRepo()
    const feature = addFeature('fix/a')

    const result = runScript(script, repo, ['--gate'])

    expect(result.status, result.stderr).toBe(1)
    expect(result.stdout).toContain('unverified fix/a: could not read its PRs (')
    expect(existsSync(feature.path)).toBe(true)
  })

  it('under --gate fails closed outside a git repository, and is silent otherwise', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'orca-wt-close-norepo-')))
    tempDirs.push(dir)

    const gated = runScript(script, dir, ['--gate'])
    const plain = runScript(script, dir, [])

    expect(gated.status, gated.stderr).toBe(1)
    expect(gated.stdout).toBe(`unverified: ${dir} is not a git repository\n`)
    expect(plain.status, plain.stderr).toBe(0)
    expect(plain.stdout).toBe('')
  })

  it('outside --gate skips a branch whose PRs it cannot read', () => {
    const { repo, addFeature } = makeRepo()
    const feature = addFeature('fix/a')

    const result = runScript(script, repo, [])

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toBe('')
    expect(existsSync(feature.path)).toBe(true)
  })

  it('skips a listed worktree whose directory is gone, without failing the gate', () => {
    const { repo, addFeature } = makeRepo()
    const feature = addFeature('fix/a')
    rmSync(feature.path, { recursive: true, force: true })

    const result = runCli(repo, { 'fix/a': [{ number: 12, headRefOid: feature.head }] }, '--gate')

    expect(result.status, result.stdout).toBe(0)
    expect(result.stdout).toContain('skipped fix/a: directory missing; run git worktree prune')
    expect(result.stdout).not.toContain('uncommitted')
  })

  it('runs when started through a symlinked directory', () => {
    const { root, repo, addFeature } = makeRepo()
    const feature = addFeature('fix/a')
    const link = join(root, 'scripts-link')
    symlinkSync(import.meta.dirname, link, 'junction')

    const result = runScript(join(link, 'merged-worktree-close.mjs'), repo, [
      '--merged-prs-file',
      writeJson(root, { 'fix/a': [{ number: 12, headRefOid: feature.head }] }),
      '--dry-run'
    ])

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain(`would close fix/a (#12) ${feature.path}`)
  })

  it('changes nothing on a dry run', () => {
    const { repo, addFeature } = makeRepo()
    const feature = addFeature('fix/a')

    const result = runCli(
      repo,
      { 'fix/a': [{ number: 12, headRefOid: feature.head }] },
      '--dry-run'
    )

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain(`would close fix/a (#12) ${feature.path}`)
    expect(existsSync(feature.path)).toBe(true)
  })
})

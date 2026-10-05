import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { orcaCliCommand, parseWorktreeList, planWorktreeClose } from './merged-worktree-close.mjs'

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

const PRIMARY = {
  path: '/repo',
  head: 'a'.repeat(40),
  branch: 'main',
  isPrimary: true
}

function worktree(branch, head) {
  return {
    path: `/repo-${branch.replaceAll('/', '-')}`,
    head,
    branch,
    isPrimary: false
  }
}

describe('planWorktreeClose', () => {
  it('closes a clean worktree whose head is the head its merged PR shipped', () => {
    const wt = worktree('fix/a', 'b'.repeat(40))
    const plan = planWorktreeClose({
      worktrees: [PRIMARY, wt],
      mergedPrs: { 'fix/a': [{ number: 12, headRefOid: 'b'.repeat(40) }] },
      dirtyPaths: new Set()
    })
    expect(plan).toEqual([
      {
        path: wt.path,
        branch: 'fix/a',
        head: wt.head,
        pr: 12,
        action: 'close'
      }
    ])
  })

  it('keeps a merged worktree that still has uncommitted changes', () => {
    const wt = worktree('fix/a', 'b'.repeat(40))
    const plan = planWorktreeClose({
      worktrees: [wt],
      mergedPrs: { 'fix/a': [{ number: 12, headRefOid: 'b'.repeat(40) }] },
      dirtyPaths: new Set([wt.path])
    })
    expect(plan).toEqual([
      {
        path: wt.path,
        branch: 'fix/a',
        head: wt.head,
        pr: 12,
        action: 'keep',
        reason: 'uncommitted changes'
      }
    ])
  })

  it('keeps a worktree whose branch moved past the head its PR merged', () => {
    const wt = worktree('fix/a', 'c'.repeat(40))
    const plan = planWorktreeClose({
      worktrees: [wt],
      mergedPrs: { 'fix/a': [{ number: 12, headRefOid: 'b'.repeat(40) }] },
      dirtyPaths: new Set()
    })
    expect(plan).toEqual([
      {
        path: wt.path,
        branch: 'fix/a',
        head: wt.head,
        pr: 12,
        action: 'keep',
        reason: 'commits after the merged head of #12'
      }
    ])
  })

  it('leaves out the primary checkout, detached heads and branches without a merged PR', () => {
    const plan = planWorktreeClose({
      worktrees: [
        { ...PRIMARY, branch: 'fix/a' },
        {
          path: '/detached',
          head: 'd'.repeat(40),
          branch: null,
          isPrimary: false
        },
        worktree('feat/open', 'e'.repeat(40))
      ],
      mergedPrs: { 'fix/a': [{ number: 12, headRefOid: PRIMARY.head }] },
      dirtyPaths: new Set()
    })
    expect(plan).toEqual([])
  })

  it('restricts the plan to one branch when asked', () => {
    const a = worktree('fix/a', 'b'.repeat(40))
    const b = worktree('fix/b', 'c'.repeat(40))
    const plan = planWorktreeClose({
      worktrees: [a, b],
      mergedPrs: {
        'fix/a': [{ number: 12, headRefOid: a.head }],
        'fix/b': [{ number: 13, headRefOid: b.head }]
      },
      dirtyPaths: new Set(),
      onlyBranch: 'fix/b'
    })
    expect(plan.map((entry) => entry.branch)).toEqual(['fix/b'])
  })
})

describe('orcaCliCommand', () => {
  it('uses the command Orca exported for this session', () => {
    expect(orcaCliCommand({ ORCA_CLI_COMMAND: 'orca-dev' })).toBe('orca-dev')
  })

  it('uses bare orca only inside an Orca terminal', () => {
    expect(orcaCliCommand({ ORCA_TERMINAL_HANDLE: 'term_1' })).toBe('orca')
  })

  // Why: outside Orca's terminals, bare `orca` on Linux is the GNOME screen reader.
  it('uses no Orca CLI outside an Orca terminal', () => {
    expect(orcaCliCommand({})).toBeNull()
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

function runCli(cwd, prs, ...args) {
  const prsFile = join(cwd, '..', `prs-${Math.random().toString(36).slice(2)}.json`)
  writeFileSync(prsFile, JSON.stringify(prs))
  return spawnSync('node', [script, '--merged-prs-file', prsFile, '--remover', 'git', ...args], {
    cwd,
    encoding: 'utf8'
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
        isPrimary: true
      },
      {
        path: feature.path,
        head: feature.head,
        branch: 'fix/a',
        isPrimary: false
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

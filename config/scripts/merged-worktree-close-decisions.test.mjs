import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  orcaCliCommand,
  orcaRemovalDecision,
  planWorktreeClose,
  windowsShellArg,
  windowsShellCommand
} from './merged-worktree-close.mjs'

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
      dirtyPaths: new Set(),
      aheadOfMerged: new Map([[wt.path, 12]])
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

  it('keeps the worktree this session runs inside, even when it is ready to close', () => {
    const wt = worktree('fix/a', 'b'.repeat(40))
    const other = worktree('fix/b', 'c'.repeat(40))
    const plan = planWorktreeClose({
      worktrees: [PRIMARY, wt, other],
      mergedPrs: {
        'fix/a': [{ number: 12, headRefOid: wt.head }],
        'fix/b': [{ number: 13, headRefOid: other.head }]
      },
      dirtyPaths: new Set(),
      skipPaths: [join(wt.path, 'src', 'deep')]
    })
    expect(plan).toEqual([
      {
        path: wt.path,
        branch: 'fix/a',
        head: wt.head,
        pr: 12,
        action: 'keep',
        reason: 'this session runs inside it'
      },
      { path: other.path, branch: 'fix/b', head: other.head, pr: 13, action: 'close' }
    ])
  })

  it('does not mistake a sibling path sharing a prefix for the session worktree', () => {
    const wt = worktree('fix/a', 'b'.repeat(40))
    const plan = planWorktreeClose({
      worktrees: [wt],
      mergedPrs: { 'fix/a': [{ number: 12, headRefOid: wt.head }] },
      dirtyPaths: new Set(),
      skipPaths: [`${wt.path}-other`]
    })
    expect(plan.map((entry) => entry.action)).toEqual(['close'])
  })

  it('leaves out a reused branch name whose head does not descend from any merged head', () => {
    const wt = worktree('fix/a', 'c'.repeat(40))
    const plan = planWorktreeClose({
      worktrees: [wt],
      mergedPrs: { 'fix/a': [{ number: 12, headRefOid: 'b'.repeat(40) }] },
      dirtyPaths: new Set(),
      aheadOfMerged: new Map()
    })
    expect(plan).toEqual([])
  })

  it('keeps a merged worktree with a recently active terminal', () => {
    const wt = worktree('fix/a', 'b'.repeat(40))
    const plan = planWorktreeClose({
      worktrees: [wt],
      mergedPrs: { 'fix/a': [{ number: 12, headRefOid: wt.head }] },
      dirtyPaths: new Set(),
      activeTerminals: new Map([[wt.path, 3]])
    })
    expect(plan).toEqual([
      {
        path: wt.path,
        branch: 'fix/a',
        head: wt.head,
        pr: 12,
        action: 'keep',
        reason: 'a terminal in it was active 3 min ago'
      }
    ])
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

describe('orcaRemovalDecision', () => {
  // Shapes `orca worktree rm --json` prints on stdout (src/cli/format.ts reportCliError).
  const failure = (code, message) => ({
    ok: false,
    stdout: JSON.stringify(
      { id: 'req-1', ok: false, error: { code, message }, _meta: { runtimeId: 'rt-1' } },
      null,
      2
    ),
    stderr: 'Command failed: orca worktree rm --worktree path:/wt --json'
  })

  it('accepts a removal Orca reports as done', () => {
    expect(orcaRemovalDecision({ ok: true, stdout: '{"ok":true}' })).toEqual({ action: 'removed' })
  })

  it('falls back to git only when Orca does not know the worktree', () => {
    expect(orcaRemovalDecision(failure('selector_not_found', 'selector_not_found'))).toEqual({
      action: 'git'
    })
    expect(orcaRemovalDecision({ ok: false, stdout: '', stderr: 'selector_not_found' })).toEqual({
      action: 'git'
    })
  })

  it.each([
    [failure('selector_ambiguous', 'selector_ambiguous'), 'selector_ambiguous'],
    [
      failure('runtime_error', 'Worktree deletion already in progress: repo-1::/wt'),
      'Worktree deletion already in progress: repo-1::/wt'
    ],
    [failure('runtime_unavailable', 'runtime_unavailable'), 'runtime_unavailable'],
    [
      failure('runtime_error', 'fatal: selector_not_found is not a branch'),
      'fatal: selector_not_found is not a branch'
    ],
    [{ ok: false, stdout: '', stderr: 'timed out after 20s' }, 'timed out after 20s']
  ])('respects any other Orca refusal: %#', (result, error) => {
    expect(orcaRemovalDecision(result)).toEqual({ action: 'fail', error })
  })
})

describe('windows shell quoting', () => {
  it.each([
    ['worktree', '"worktree"'],
    ['path:C:\\Users\\a b\\wt', '"path:C:\\Users\\a b\\wt"'],
    ['say "hi"', '"say \\"hi\\""'],
    ['C:\\dir\\', '"C:\\dir\\\\"'],
    ['a\\"b', '"a\\\\\\"b"'],
    ['', '""']
  ])('%j -> %j', (value, quoted) => {
    expect(windowsShellArg(value)).toBe(quoted)
  })

  it('quotes the command only when it has spaces', () => {
    expect(windowsShellCommand('orca')).toBe('orca')
    expect(windowsShellCommand('C:\\Program Files\\Orca\\orca.cmd')).toBe(
      '"C:\\Program Files\\Orca\\orca.cmd"'
    )
  })
})

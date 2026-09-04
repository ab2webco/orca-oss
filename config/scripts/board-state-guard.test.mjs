import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const projectDir = resolve(import.meta.dirname, '../..')
const hookScript = join(projectDir, '.claude/hooks/board-state-guard.py')
const settingsPath = join(projectDir, '.claude/settings.json')
const tempDirs = []

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

/** A repo on a branch whose name carries the ticket, like the real worktrees. */
function makeRepo(branch) {
  const root = mkdtempSync(join(tmpdir(), 'orca-board-state-guard-'))
  tempDirs.push(root)
  git(root, ['init', '--quiet'])
  git(root, ['config', 'user.email', 'board-state-guard-test@example.com'])
  git(root, ['config', 'user.name', 'Board State Guard Test'])
  git(root, ['checkout', '--quiet', '-b', branch])
  return root
}

function writeStub(bin, name, body) {
  const path = join(bin, name)
  writeFileSync(path, body)
  chmodSync(path, 0o755)
}

/**
 * Stub `orca` and `gh` earlier on PATH than the real ones. `state` null makes
 * the board lookup fail, which is a separate case from a ticket in the wrong
 * column; `prTitle` null makes `gh pr view` fail, as it would offline.
 */
function makeStubBin(state, prTitle) {
  const bin = mkdtempSync(join(tmpdir(), 'orca-board-state-guard-bin-'))
  tempDirs.push(bin)
  writeStub(
    bin,
    'orca',
    state === null
      ? '#!/bin/sh\nexit 1\n'
      : `#!/bin/sh\ncat <<'JSON'\n${JSON.stringify({
          ok: true,
          result: { workItem: { identifier: 'ORCA-155', state: { name: state } } }
        })}\nJSON\n`
  )
  writeStub(
    bin,
    'gh',
    prTitle === null
      ? '#!/bin/sh\nexit 1\n'
      : `#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(prTitle)}\n`
  )
  return bin
}

function runHook({ command, cwd, state = 'In Progress', prTitle = null }) {
  const stubBin = makeStubBin(state, prTitle)
  const result = spawnSync('python3', [hookScript], {
    input: JSON.stringify({ tool_input: { command }, cwd }),
    encoding: 'utf8',
    env: { ...process.env, PATH: `${stubBin}:${process.env.PATH}` }
  })
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout || '{}')
}

function decision(output) {
  return output.hookSpecificOutput?.permissionDecision
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('board-state-guard', () => {
  it('is wired as a PreToolUse Bash hook', () => {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
    const wired = (settings.hooks?.PreToolUse ?? []).some(
      ({ matcher, hooks }) =>
        matcher === 'Bash' &&
        hooks?.some(({ command }) => command.endsWith('/board-state-guard.py'))
    )
    expect(wired).toBe(true)
  })

  it('ignores commands that neither open nor merge a PR', () => {
    const cwd = makeRepo('fabolivark/orca-155-mobile-plane')
    const output = runHook({ command: 'gh pr list --state open', cwd, state: 'Backlog' })
    expect(output).toEqual({})
  })

  it('allows opening a PR when its ticket is In Progress', () => {
    const cwd = makeRepo('fabolivark/orca-155-mobile-plane')
    const output = runHook({ command: 'gh pr create --base main', cwd })
    expect(decision(output)).toBeUndefined()
    expect(output.systemMessage).toContain('ORCA-155')
  })

  // The defect this guard exists for: PRs opened and merged with the ticket
  // still sitting in Backlog, which nothing in the terminal reveals.
  it('refuses to open a PR whose ticket is still in Backlog', () => {
    const cwd = makeRepo('fabolivark/orca-155-mobile-plane')
    const output = runHook({ command: 'gh pr create --base main', cwd, state: 'Backlog' })
    expect(decision(output)).toBe('deny')
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain('status set')
  })

  it('refuses to open a PR whose ticket is only in Todo', () => {
    const cwd = makeRepo('fabolivark/orca-155-mobile-plane')
    const output = runHook({ command: 'gh pr create --base main', cwd, state: 'Todo' })
    expect(decision(output)).toBe('deny')
  })

  it('reads the ticket from the command when the branch does not carry one', () => {
    const cwd = makeRepo('fabolivark/some-branch')
    const output = runHook({
      command: 'gh pr create --title "fix(x): thing (ORCA-155)"',
      cwd,
      state: 'Backlog'
    })
    expect(decision(output)).toBe('deny')
  })

  it('refuses a PR that names no ticket at all', () => {
    const cwd = makeRepo('fabolivark/some-branch')
    const output = runHook({ command: 'gh pr create --title "chore: bump"', cwd })
    expect(decision(output)).toBe('deny')
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain('no-ticket:')
  })

  it('lets an explicit reason stand in for a ticket', () => {
    const cwd = makeRepo('fabolivark/some-branch')
    const output = runHook({
      command: 'gh pr create --title "chore: bump" # no-ticket: version bump for the release',
      cwd
    })
    expect(decision(output)).toBeUndefined()
    expect(output.systemMessage).toContain('version bump for the release')
  })

  // Why this is a deny and not a warning: an unreachable board and a misaligned
  // board produce the same silence, and treating that as consent is how the
  // board fell behind in the first place.
  it('refuses rather than assume when the board cannot be read', () => {
    const cwd = makeRepo('fabolivark/orca-155-mobile-plane')
    const output = runHook({ command: 'gh pr create --base main', cwd, state: null })
    expect(decision(output)).toBe('deny')
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain('board inaccesible')
  })

  it('lets a merge through but names the move it still needs', () => {
    const cwd = makeRepo('fabolivark/orca-155-mobile-plane')
    const output = runHook({ command: 'gh pr merge 247 --squash', cwd })
    expect(decision(output)).toBeUndefined()
    expect(output.systemMessage).toContain('Done')
  })

  // The defect that made the guard deny every merge it was meant to allow: the
  // coordinator merges standing on `main`, so no branch names a ticket and the
  // command carries only a PR number. Every earlier case ran from a
  // ticket-named branch, so the fixture looked exactly like the caller allowed.
  it('resolves the ticket from the PR title when merging from main', () => {
    const cwd = makeRepo('main')
    const output = runHook({
      command: 'gh pr merge 250 --squash --delete-branch',
      cwd,
      prTitle: 'docs(headless): register agent accounts (ORCA-155)'
    })
    expect(decision(output)).toBeUndefined()
    expect(output.systemMessage).toContain('ORCA-155')
    expect(output.systemMessage).toContain('Done')
  })

  it('still refuses a merge whose PR title names no ticket', () => {
    const cwd = makeRepo('main')
    const output = runHook({
      command: 'gh pr merge 250 --squash',
      cwd,
      prTitle: 'chore: unrelated'
    })
    expect(decision(output)).toBe('deny')
  })

  it('does not consult the PR title when opening a PR', () => {
    const cwd = makeRepo('main')
    const output = runHook({
      command: 'gh pr create --title "chore: bump"',
      cwd,
      prTitle: 'anything (ORCA-155)'
    })
    expect(decision(output)).toBe('deny')
  })

  it('says nothing more to move when the merged ticket is already Done', () => {
    const cwd = makeRepo('fabolivark/orca-155-mobile-plane')
    const output = runHook({ command: 'gh pr merge 247 --squash', cwd, state: 'Done' })
    expect(output.systemMessage).toContain('ya está en Done')
  })
})

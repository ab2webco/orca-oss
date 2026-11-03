import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const projectDir = resolve(import.meta.dirname, '../..')
const hookScript = join(projectDir, '.claude/hooks/session-start-lead-recovery.sh')
const tempDirs = []

function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

function makeRepo() {
  const primary = tempDir('orca-lead-recovery-repo-')
  git(primary, ['init', '--quiet'])
  git(primary, ['config', 'user.email', 'lead-recovery-test@example.com'])
  git(primary, ['config', 'user.name', 'Lead Recovery Test'])
  git(primary, ['commit', '--quiet', '--allow-empty', '-m', 'base'])
  const linked = join(tempDir('orca-lead-recovery-wt-'), 'member')
  git(primary, ['worktree', 'add', '--quiet', '-b', 'member', linked])
  return { primary, linked }
}

// Why role=lead even for members: that is what `game state` wrongly answers today (ORCA-991),
// so only the hook's own gate can keep a member from resuming anyone.
function makeStubs() {
  const bin = tempDir('orca-lead-recovery-bin-')
  const log = join(bin, 'calls.log')
  const cli = join(bin, 'orca')
  writeFileSync(
    cli,
    [
      '#!/bin/sh',
      `echo "$*" >> '${log}'`,
      'case "$*" in',
      `  "game state --json") echo '{"result":{"role":"lead"}}' ;;`,
      '  "game resume-members --dry-run") echo "Would resume: ORCA-1" ;;',
      '  "game resume-members") echo "resumed ORCA-1" ;;',
      '  "game fleet") echo "FLEET-TABLE" ;;',
      'esac',
      ''
    ].join('\n')
  )
  const gh = join(bin, 'gh')
  writeFileSync(
    gh,
    [
      '#!/bin/sh',
      'case "$*" in',
      "  *'--state all'*) echo '[]' ;;",
      "  *'--state open'*) echo '#893 CLEAN auto=off fix(hooks): lead recovery' ;;",
      'esac',
      ''
    ].join('\n')
  )
  chmodSync(cli, 0o755)
  chmodSync(gh, 0o755)
  return { bin, cli, log }
}

function runHook(cwd, extraEnv = {}) {
  const stubs = makeStubs()
  const env = { ...process.env, PATH: `${stubs.bin}:${process.env.PATH}`, ORCA_GAME_CLI: stubs.cli }
  // Why: this suite itself runs inside Orca member terminals, which export ORCA_GAME_ROLE.
  delete env.ORCA_GAME_ROLE
  for (const name of Object.keys(env).filter((key) => key.startsWith('GIT_'))) {
    delete env[name]
  }
  const result = spawnSync('bash', [hookScript], {
    cwd,
    env: { ...env, ...extraEnv },
    encoding: 'utf8'
  })
  const calls = existsSync(stubs.log) ? readFileSync(stubs.log, 'utf8') : ''
  return { status: result.status, stdout: result.stdout, calls }
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('session-start-lead-recovery hook', () => {
  it('resumes members and lists pending work in the lead checkout', () => {
    const { primary } = makeRepo()
    const result = runHook(primary)
    expect(result.status).toBe(0)
    expect(result.calls).toContain('game resume-members --dry-run')
    expect(result.calls.split('\n')).toContain('game resume-members')
    expect(result.stdout).toContain('== Lead: members')
    expect(result.stdout).toContain('FLEET-TABLE')
    expect(result.stdout).toContain('#893 CLEAN')
  })

  it('does nothing in a session Orca launched as a member', () => {
    const { primary } = makeRepo()
    const result = runHook(primary, { ORCA_GAME_ROLE: 'member' })
    expect(result.status).toBe(0)
    expect(result.calls).toBe('')
    expect(result.stdout).not.toContain('== Lead')
  })

  it('does nothing in a linked worktree even when game state says lead', () => {
    const { linked } = makeRepo()
    const result = runHook(linked)
    expect(result.status).toBe(0)
    expect(result.calls).toBe('')
    expect(result.stdout).not.toContain('== Lead')
  })

  it('does nothing without ORCA_GAME_CLI', () => {
    const { primary } = makeRepo()
    const result = runHook(primary, { ORCA_GAME_CLI: '' })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
  })
})

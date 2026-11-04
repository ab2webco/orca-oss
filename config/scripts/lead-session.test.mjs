import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const script = resolve(import.meta.dirname, '../../.claude/hooks/lead-session.sh')
const tempDirs = []

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'orca-lead-session-'))
  tempDirs.push(dir)
  return dir
}

function makeRepo() {
  const primary = tempDir()
  const git = (...args) => execFileSync('git', args, { cwd: primary, stdio: 'ignore' })
  git('init', '--quiet')
  git('-c', 'user.name=t', '-c', 'user.email=t@e.co', 'commit', '-q', '--allow-empty', '-m', 'b')
  const linked = join(tempDir(), 'member')
  git('worktree', 'add', '--quiet', '-b', 'member', linked)
  return { primary, linked }
}

function stubCli(body) {
  const dir = tempDir()
  const cli = join(dir, 'orca-stub')
  const log = join(dir, 'calls.log')
  writeFileSync(cli, `#!/bin/sh\necho "$*" >> '${log}'\n${body}\n`)
  chmodSync(cli, 0o755)
  return { cli, log }
}

const ROLE_LEAD = `echo '{"result":{"role":"lead"}}'`

function check(cwd, extraEnv) {
  const env = { ...process.env, ...extraEnv }
  // Why: this suite itself runs inside Orca member terminals, which export both.
  for (const name of ['ORCA_GAME_ROLE', 'ORCA_GAME_CLI']) {
    if (!(name in extraEnv)) {
      delete env[name]
    }
  }
  for (const name of Object.keys(env).filter((key) => key.startsWith('GIT_'))) {
    delete env[name]
  }
  const { status, stdout } = spawnSync('bash', [script], { cwd, env, encoding: 'utf8' })
  return { status, stdout: stdout.trim() }
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('lead-session', () => {
  it('passes the lead in the primary checkout, silently', () => {
    const { primary } = makeRepo()
    const { cli } = stubCli(ROLE_LEAD)
    expect(check(primary, { ORCA_GAME_CLI: cli })).toEqual({ status: 0, stdout: '' })
  })

  it('passes a lead in a folder workspace, which has no git at all', () => {
    const { cli } = stubCli(ROLE_LEAD)
    expect(check(tempDir(), { ORCA_GAME_CLI: cli }).status).toBe(0)
  })

  // Why: `game state` answers lead for a member whose pane has no parent row (ORCA-991).
  it('refuses a member even though game state says lead, without asking it', () => {
    const { primary } = makeRepo()
    const { cli, log } = stubCli(ROLE_LEAD)
    const result = check(primary, { ORCA_GAME_CLI: cli, ORCA_GAME_ROLE: 'member' })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('member')
    expect(existsSync(log)).toBe(false)
  })

  it('refuses a linked worktree even though game state says lead', () => {
    const { linked } = makeRepo()
    const { cli } = stubCli(ROLE_LEAD)
    const result = check(linked, { ORCA_GAME_CLI: cli })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('worktree enlazada')
  })

  it('refuses a plain session with no Orca CLI', () => {
    const { primary } = makeRepo()
    const result = check(primary, {})
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('sin ORCA_GAME_CLI')
  })

  it('refuses a session Orca does not call lead', () => {
    const { primary } = makeRepo()
    const { cli, log } = stubCli(`echo '{"result":{"role":"none"}}'`)
    const result = check(primary, { ORCA_GAME_CLI: cli })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('no es el lead')
    expect(readFileSync(log, 'utf8').trim()).toBe('game state --json')
  })

  it.each([
    ['fails', 'exit 1'],
    ['prints garbage', 'echo not-json']
  ])('refuses when game state %s', (_, body) => {
    const { primary } = makeRepo()
    const { cli } = stubCli(body)
    expect(check(primary, { ORCA_GAME_CLI: cli }).status).toBe(1)
  })
})

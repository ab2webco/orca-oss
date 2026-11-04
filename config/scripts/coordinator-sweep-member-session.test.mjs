import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const projectDir = resolve(import.meta.dirname, '../..')
const sweepScript = join(projectDir, '.claude/hooks/coordinator-sweep.sh')
const tempDirs = []

function writeStub(bin, name, body) {
  const path = join(bin, name)
  writeFileSync(path, body)
  chmodSync(path, 0o755)
}

/** Runs the session-start sweep from a primary checkout with gh stubbed to log each call it gets. */
function sessionStart({ role, gameRole } = {}) {
  const bin = mkdtempSync(join(tmpdir(), 'orca-sweep-member-'))
  tempDirs.push(bin)
  const checkout = join(bin, 'checkout')
  execFileSync('git', ['init', '--quiet', checkout])
  const ghLog = join(bin, 'gh.log')
  writeStub(bin, 'gh', `#!/bin/sh\necho "$*" >> '${ghLog}'\nexit 0\n`)
  writeStub(bin, 'orca', '#!/bin/sh\nexit 1\n')
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, ORCA_SWEEP_ROOT: projectDir }
  // Why: this suite itself runs inside Orca member terminals, which export both.
  delete env.ORCA_GAME_ROLE
  delete env.ORCA_GAME_CLI
  env.ORCA_CLI_COMMAND = join(bin, 'orca')
  if (role) {
    env.ORCA_GAME_ROLE = role
  }
  if (gameRole) {
    env.ORCA_GAME_CLI = join(bin, 'orca-game')
    writeStub(bin, 'orca-game', `#!/bin/sh\necho '{"result":{"role":"${gameRole}"}}'\n`)
  }
  const result = spawnSync('bash', [sweepScript, '--once'], {
    encoding: 'utf8',
    cwd: checkout,
    env
  })
  return { stdout: result.stdout, ghCalls: existsSync(ghLog) ? readFileSync(ghLog, 'utf8') : '' }
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('coordinator-sweep at session start', () => {
  // Why: every member ran it on start and was told to arm a 30-minute monitor, multiplying the
  // sweep's GitHub calls by the fleet size (ORCA-877).
  it('stays out of a member session: no GitHub calls and no monitor to arm', () => {
    const { stdout, ghCalls } = sessionStart({ role: 'member', gameRole: 'lead' })
    expect(ghCalls).toBe('')
    expect(stdout).toBe('')
  })

  // Why: a plain session used to be told to arm a Monitor and delete worktrees (ORCA-1021).
  it.each([
    ['with no Orca CLI', {}],
    ['Orca does not call lead', { gameRole: 'none' }]
  ])('gives no coordinator text to a plain session: %s', (_, session) => {
    const { stdout, ghCalls } = sessionStart(session)
    expect(ghCalls).toBe('')
    expect(stdout).toBe('')
  })

  it('still sweeps for the lead', () => {
    const { stdout, ghCalls } = sessionStart({ gameRole: 'lead' })
    expect(ghCalls).toContain('pr list')
    expect(stdout).toContain('SWEEP')
    expect(stdout).toContain('Monitor')
  })
})

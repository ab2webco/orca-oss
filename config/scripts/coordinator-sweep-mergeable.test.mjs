import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

const check = (name, conclusion) => ({ __typename: 'CheckRun', name, conclusion })
const pr = (number, mergeStateStatus, statusCheckRollup, body = '') => ({
  number,
  mergeStateStatus,
  statusCheckRollup,
  baseRefName: 'main',
  body
})

/** Runs one sweep tick with `gh pr list` answering `prs` and returns its buckets. */
function sweep(prs) {
  const bin = mkdtempSync(join(tmpdir(), 'orca-sweep-bin-'))
  const root = mkdtempSync(join(tmpdir(), 'orca-sweep-root-'))
  tempDirs.push(bin, root)
  const payload = join(bin, 'prs.json')
  writeFileSync(payload, JSON.stringify(prs))
  writeStub(
    bin,
    'gh',
    `#!/bin/sh\ncase "$*" in\n  *mergeStateStatus*) cat '${payload}' ;;\n  *) true ;;\nesac\n`
  )
  writeStub(bin, 'orca', '#!/bin/sh\necho \'{"ok":true,"result":[]}\'\n')
  const result = spawnSync('bash', [sweepScript, '--tick'], {
    encoding: 'utf8',
    cwd: projectDir,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      ORCA_CLI_COMMAND: join(bin, 'orca'),
      ORCA_SWEEP_ROOT: root
    }
  })
  const line = (result.stdout || '').split('\n').find((l) => l.startsWith('SWEEP'))
  expect(line, result.stderr).toBeTruthy()
  const field = (name) => line.match(new RegExp(`\\| ${name}:([^|]*?) *(?:\\||$)`))?.[1]
  return {
    mergeable: field('mergeable'),
    held: field('held'),
    unverified: field('unverified'),
    red: field('red'),
    pending: field('pending')
  }
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('coordinator-sweep mergeable', () => {
  // ORCA-1103 #4: a rollup lists only checks that started, so a PR whose required verify never ran read green.
  it('does not call a PR with an empty rollup mergeable', () => {
    const out = sweep([pr(990, 'CLEAN', [])])
    expect(out.mergeable).toBe('none')
    expect(out.unverified).toBe('#990')
  })

  it('does not call a PR with only accessory checks mergeable', () => {
    const out = sweep([
      pr(990, 'BLOCKED', [check('PR text', 'SUCCESS'), check('Plane ticket', 'SUCCESS')])
    ])
    expect(out.mergeable).toBe('none')
    expect(out.unverified).toBe('#990')
  })

  it('does not call a PR mergeable while GitHub blocks it, even with verify green', () => {
    expect(sweep([pr(995, 'UNSTABLE', [check('verify', 'SUCCESS')])]).mergeable).toBe('none')
  })

  it('calls a PR mergeable with verify SUCCESS and a CLEAN merge state', () => {
    expect(sweep([pr(989, 'CLEAN', [check('verify', 'SUCCESS')])]).mergeable).toBe('#989')
  })

  it('holds a PR whose body names a still-open PR', () => {
    const verified = [check('verify', 'SUCCESS')]
    const out = sweep([
      pr(987, 'CLEAN', verified, 'Merge after #985 lands.'),
      pr(985, 'BLOCKED', [check('verify', 'IN_PROGRESS')]),
      pr(986, 'CLEAN', verified, 'Follows #900, already merged.')
    ])
    expect(out.held).toBe('#987(after-#985)')
    expect(out.mergeable).toBe('#986')
  })

  it('lists CANCELLED and TIMED_OUT as red, not pending', () => {
    const out = sweep([
      pr(1, 'BLOCKED', [check('verify', 'CANCELLED')]),
      pr(2, 'BLOCKED', [check('e2e', 'TIMED_OUT')])
    ])
    expect(out.red).toBe('#1 #2')
    expect(out.pending).toBe('none')
  })
})

const run = (workflowName, name, conclusion, startedAt, extra = {}) => ({
  __typename: 'CheckRun',
  workflowName,
  name,
  conclusion,
  startedAt,
  completedAt: startedAt,
  ...extra
})
const context = (name, state, startedAt) => ({
  __typename: 'StatusContext',
  context: name,
  state,
  startedAt
})
const verify = run('PR Checks', 'verify', 'SUCCESS', '2026-11-16T18:31:06Z')

// ORCA-1243: a rollup keeps superseded runs, so only the latest run of each check decides.
describe('coordinator-sweep latest run per check', () => {
  it('does not call a PR red when a cancelled run was superseded by a passing one', () => {
    // Listed newest first, as #1275's rollup did, so array order cannot decide it.
    const out = sweep([
      pr(1275, 'CLEAN', [
        run('PR text', 'pr text attribution', 'SUCCESS', '2026-11-16T18:18:58Z'),
        run('PR text', 'pr text attribution', 'CANCELLED', '2026-11-16T18:17:56Z'),
        verify
      ])
    ])
    expect(out.red).toBe('none')
    expect(out.mergeable).toBe('#1275')
  })

  it('still calls a PR red when a passing run was followed by a failing one', () => {
    const out = sweep([
      pr(1276, 'BLOCKED', [
        run('PR text', 'pr text attribution', 'FAILURE', '2026-11-16T18:18:58Z'),
        run('PR text', 'pr text attribution', 'SUCCESS', '2026-11-16T18:17:56Z'),
        verify
      ])
    ])
    expect(out.red).toBe('#1276')
    expect(out.mergeable).toBe('none')
  })

  it('reduces status contexts, which have no workflowName, by their context', () => {
    const out = sweep([
      pr(1277, 'CLEAN', [
        context('ci/external', 'SUCCESS', '2026-11-16T18:20:00Z'),
        context('ci/external', 'ERROR', '2026-11-16T18:10:00Z'),
        verify
      ])
    ])
    expect(out.red).toBe('none')
    expect(out.mergeable).toBe('#1277')
  })

  it('keeps checks of the same name in different workflows apart', () => {
    const out = sweep([
      pr(1278, 'BLOCKED', [
        run('Mobile Checks', 'lint', 'FAILURE', '2026-11-16T18:10:00Z'),
        run('PR Checks', 'lint', 'SUCCESS', '2026-11-16T18:20:00Z'),
        verify
      ])
    ])
    expect(out.red).toBe('#1278')
  })

  it('reads a queued re-run with no start time as pending, not the cancelled run before it', () => {
    const out = sweep([
      pr(1279, 'BLOCKED', [
        run('PR text', 'pr text attribution', 'CANCELLED', '2026-11-16T18:17:56Z'),
        run('PR text', 'pr text attribution', '', '0001-01-01T00:00:00Z', {
          completedAt: '0001-01-01T00:00:00Z',
          status: 'QUEUED'
        }),
        verify
      ])
    ])
    expect(out.red).toBe('none')
    expect(out.pending).toBe('#1279')
  })
})

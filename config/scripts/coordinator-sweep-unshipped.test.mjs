import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const projectDir = resolve(import.meta.dirname, '../..')
const sweepScript = join(projectDir, '.claude/hooks/coordinator-sweep.sh')
const tempDirs = []
const DAY = 86_400

function writeStub(bin, name, body) {
  const path = join(bin, name)
  writeFileSync(path, body)
  chmodSync(path, 0o755)
}

/**
 * One worktree on `feature/done-work` at /wt/done-work, `ahead` commits past
 * origin/main whose newest is `ageSeconds` old.
 */
function sweepLine({ ahead, ageSeconds, openPr = false, mergedPr = false, liveTerminal = false }) {
  const bin = mkdtempSync(join(tmpdir(), 'orca-sweep-unshipped-'))
  tempDirs.push(bin)
  const lastCommit = Math.floor(Date.now() / 1000) - ageSeconds
  writeStub(
    bin,
    'git',
    `#!/bin/sh
case "$1" in
  worktree) printf 'worktree /wt/main\\nbranch refs/heads/main\\n\\nworktree /wt/done-work\\nbranch refs/heads/feature/done-work\\n' ;;
  rev-list) echo ${ahead} ;;
  log) echo ${lastCommit} ;;
esac
`
  )
  writeStub(
    bin,
    'gh',
    `#!/bin/sh
case "$*" in
  *"--head feature/done-work --state open"*) ${openPr ? 'echo 7' : 'true'} ;;
  *"--head feature/done-work --state merged"*) ${mergedPr ? 'echo 6' : 'true'} ;;
esac
`
  )
  const terminals = liveTerminal
    ? '{"result":{"terminals":[{"liveness":"running","worktreePath":"/wt/done-work"}]}}'
    : '{"result":{"terminals":[]}}'
  writeStub(
    bin,
    'orca',
    `#!/bin/sh
case "$1" in
  terminal) echo '${terminals}' ;;
  *) echo '{"ok":true,"result":[]}' ;;
esac
`
  )
  const result = spawnSync('bash', [sweepScript, '--tick'], {
    encoding: 'utf8',
    cwd: projectDir,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }
  })
  const line = (result.stdout || '').split('\n').find((l) => l.startsWith('SWEEP'))
  expect(line, result.stderr).toBeTruthy()
  return line
}

const field = (line, name) => line.match(new RegExp(`${name}:(\\S+)`))?.[1]

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('coordinator-sweep unshipped work', () => {
  // The defect: ORCA-560 sat finished for three days with local commits and no PR,
  // and the sweep listed it nowhere.
  it('reports a branch with commits, no PR and nothing new for over a day', () => {
    expect(field(sweepLine({ ahead: 3, ageSeconds: 3 * DAY }), 'unshipped')).toBe('done-work(3d)')
  })

  it('stays quiet about a branch committed to within the last day', () => {
    expect(field(sweepLine({ ahead: 3, ageSeconds: 3600 }), 'unshipped')).toBe('none')
  })

  it('stays quiet about a branch whose terminal is still running', () => {
    const line = sweepLine({ ahead: 3, ageSeconds: 3 * DAY, liveTerminal: true })
    expect(field(line, 'unshipped')).toBe('none')
  })

  it('stays quiet about a branch with an open PR', () => {
    const line = sweepLine({ ahead: 3, ageSeconds: 3 * DAY, openPr: true })
    expect(field(line, 'unshipped')).toBe('none')
  })

  // Squash merges leave the branch ahead of main forever; that is leftover, not unshipped.
  it('calls a squash-merged branch leftover, not unshipped', () => {
    const line = sweepLine({ ahead: 3, ageSeconds: 3 * DAY, mergedPr: true })
    expect(field(line, 'unshipped')).toBe('none')
    expect(field(line, 'leftover-worktrees')).toBe('done-work')
  })
})

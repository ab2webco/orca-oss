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

/**
 * `planeStdout` null makes `orca plane list` fail the way an outage or an
 * exhausted API does; a payload stands in for a board that answered.
 */
function makeStubBin(planeStdout) {
  const bin = mkdtempSync(join(tmpdir(), 'orca-sweep-bin-'))
  tempDirs.push(bin)
  writeStub(
    bin,
    'orca',
    planeStdout === null ? '#!/bin/sh\nexit 1\n' : `#!/bin/sh\ncat <<'JSON'\n${planeStdout}\nJSON\n`
  )
  // Why gh returns nothing: the merged-PR half is not what these cases measure.
  writeStub(bin, 'gh', '#!/bin/sh\nexit 0\n')
  writeStub(bin, 'git', '#!/bin/sh\nexit 0\n')
  return bin
}

function sweepLine(planeStdout) {
  const stubBin = makeStubBin(planeStdout)
  const result = spawnSync('bash', [sweepScript, '--tick'], {
    encoding: 'utf8',
    cwd: projectDir,
    env: { ...process.env, PATH: `${stubBin}:${process.env.PATH}` }
  })
  // Why `--tick`: bare invocation is the Monitor's endless loop and never returns.
  const line = (result.stdout || '').split('\n').find((l) => l.startsWith('SWEEP'))
  expect(line, result.stderr).toBeTruthy()
  return line
}

function drift(line) {
  return line.match(/board-drift:(\S+)/)?.[1]
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('coordinator-sweep board-drift', () => {
  // The defect: a healthy board with nothing in progress read as "no sé",
  // which trains everyone to ignore the counter that exists to be read.
  it('reports none when the board answered with nothing in progress', () => {
    expect(drift(sweepLine('{"ok":true,"result":[]}'))).toBe('none')
  })

  it('reports ? when the board could not be read at all', () => {
    expect(drift(sweepLine(null))).toBe('?')
  })

  it('reports ? when the board answered but refused the query', () => {
    expect(drift(sweepLine('{"ok":false,"error":{"code":"invalid_argument"}}'))).toBe('?')
  })
})

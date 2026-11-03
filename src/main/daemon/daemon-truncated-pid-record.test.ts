import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseDaemonPidFile } from './daemon-pid-file-parse'
import { getDaemonPidPath, publishDaemonPidFile } from './daemon-spawner'
import { killStaleDaemon } from './daemon-stale-kill'

// ORCA-990: a power loss left daemon-v35.pid at 0 bytes. Every later launch forked a daemon that
// died on its exclusive pid publish (EEXIST), so the host ran all day on local, non-persistent PTYs.
describe('truncated daemon pid record', () => {
  let runtimeDir: string
  let pidPath: string

  beforeEach(() => {
    runtimeDir = mkdtempSync(join(tmpdir(), 'daemon-truncated-pid-'))
    pidPath = getDaemonPidPath(runtimeDir)
  })

  afterEach(() => {
    rmSync(runtimeDir, { recursive: true, force: true })
  })

  it.each([
    ['empty', ''],
    ['whitespace', ' \n'],
    ['NUL-filled', '\0\0\0\0'],
    ['pid zero', '0'],
    ['negative pid', '-1'],
    ['fractional pid', '12.5'],
    ['JSON pid zero', '{"pid":0}']
  ])('names no owner for a %s record', (_label, contents) => {
    expect(parseDaemonPidFile(contents)).toBeNull()
  })

  it.each([
    ['empty', ''],
    ['NUL-filled', '\0\0\0\0']
  ])('lets the next daemon publish after a %s record and a dead endpoint', async (_l, contents) => {
    writeFileSync(pidPath, contents)

    const outcome = await killStaleDaemon(
      runtimeDir,
      join(runtimeDir, 'daemon.sock'),
      join(runtimeDir, 'daemon.token'),
      undefined,
      { probeEndpoint: async () => 'refused' }
    )

    expect(outcome).toEqual({ killed: false, liveOwnerSurvived: false })
    // The forked daemon's own publish, which threw EEXIST before the fix.
    expect(() =>
      publishDaemonPidFile(pidPath, { pid: process.pid, startedAtMs: 1, launchNonce: 'n' })
    ).not.toThrow()
    expect(parseDaemonPidFile(readFileSync(pidPath, 'utf8'))?.pid).toBe(process.pid)
  })
})

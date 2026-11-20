import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const CHILD_TOKEN = 'orca-hang-record-test-child'

// The host starts the real watchdog worker, then parks its main thread in spawnSync
// (0% CPU, like the 2026-11-19 hang) until the record holds a thread section.
const HOST_SCRIPT = `
const { Worker } = require('node:worker_threads')
const { spawnSync } = require('node:child_process')
const { join } = require('node:path')
const [entryPath, userDataPath, waiterPath, token] = process.argv.slice(2)
const worker = new Worker(entryPath, {
  workerData: {
    parentPid: process.pid,
    markerPath: join(userDataPath, 'main-thread-hang.json'),
    userDataPath,
    timeoutMs: 500,
    checkIntervalMs: 100
  }
})
const beat = setInterval(() => worker.postMessage({ type: 'heartbeat' }), 100)
setTimeout(() => {
  spawnSync(process.execPath, [waiterPath, userDataPath, token], { stdio: 'inherit', timeout: 60000 })
  setTimeout(() => {
    clearInterval(beat)
    worker.postMessage({ type: 'shutdown' })
    process.exit(0)
  }, 500)
}, 300)
`

const WAITER_SCRIPT = `
const { readdirSync, readFileSync } = require('node:fs')
const { join } = require('node:path')
const dir = join(process.argv[2], 'logs')
const deadline = Date.now() + 55000
const captured = () => {
  try {
    return readdirSync(dir).some((name) =>
      name.endsWith('.txt') &&
      /== Threads of the main process ==\\r?\\n\\S/.test(readFileSync(join(dir, name), 'utf8'))
    )
  } catch {
    return false
  }
}
const timer = setInterval(() => {
  if (captured() || Date.now() > deadline) clearInterval(timer)
}, 100)
`

describe('main-thread hang record', () => {
  let root: string
  let entryPath: string

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'orca-hang-record-'))
    entryPath = join(root, 'main-thread-hang-watchdog-entry.cjs')
    await build({
      entryPoints: [
        join(process.cwd(), 'src/main/hang-watchdog/main-thread-hang-watchdog-entry.ts')
      ],
      outfile: entryPath,
      bundle: true,
      platform: 'node',
      target: 'node18',
      format: 'cjs',
      logLevel: 'silent'
    })
    writeFileSync(join(root, 'host.cjs'), HOST_SCRIPT)
    writeFileSync(join(root, 'waiter.cjs'), WAITER_SCRIPT)
  }, 30_000)

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  // TEMPORARY (ORCA-1303): 50 runs on Linux CI; reverted before merge.
  it.each(Array.from({ length: 50 }, (_, run) => run))(
    'records where a blocked main thread waits and when it answers again (run %i)',
    (run) => {
      const userDataPath = join(root, `user-data-${run}`)
      const host = spawnSync(
        process.execPath,
        [join(root, 'host.cjs'), entryPath, userDataPath, join(root, 'waiter.cjs'), CHILD_TOKEN],
        { encoding: 'utf8', timeout: 90_000 }
      )
      expect(host.status, host.stderr).toBe(0)

      const logsDir = join(userDataPath, 'logs')
      const records = readdirSync(logsDir).filter((name) => name.endsWith('.txt'))
      expect(records).toEqual([expect.stringMatching(new RegExp(`^main-hang-${host.pid}-`))])
      const text = readFileSync(join(logsDir, records[0]), 'utf8')
      expect(text).toContain(`Orca Lab main process ${host.pid} stopped answering`)
      // The child the main thread is parked on names the wait.
      expect(text).toContain(CHILD_TOKEN)
      if (process.platform === 'darwin') {
        // sample's main-thread stack reaches the spawnSync the thread is parked in.
        expect(text).toContain('com.apple.main-thread')
        expect(text).toContain('SyncProcessRunner')
      } else if (process.platform === 'linux') {
        expect(text).toMatch(new RegExp(`^${host.pid} \\S+ state=S `, 'm'))
      }
      expect(text).toMatch(/Main thread answered again after \d+ ms\.\n$/)
      const marker = JSON.parse(readFileSync(join(userDataPath, 'main-thread-hang.json'), 'utf8'))
      expect(marker).toMatchObject({
        parentPid: host.pid,
        selfRecovered: true,
        reportPath: join(logsDir, records[0])
      })
    },
    120_000
  )
})

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const FIXTURE_PATH = path.join(
  import.meta.dirname,
  'fixtures',
  'codex-inline-live-block-fixture.cjs'
)

// Reproduces what the OS can do to a plain writeFileSync: the target is opened
// with O_TRUNC and the write never lands. Anything the fixture publishes under
// that must still be readable, so the e2e premise cannot observe an empty file.
const INTERRUPTED_WRITE_PRELOAD = `const fs = require('node:fs')
const published = process.env.ORCA_HEARTBEAT_PUBLISHED
const armed = process.env.ORCA_HEARTBEAT_ARMED
const originalWriteFileSync = fs.writeFileSync
fs.writeFileSync = (target, ...rest) => {
  if (typeof target !== 'string' || !target.startsWith(published) || !fs.existsSync(published)) {
    return originalWriteFileSync(target, ...rest)
  }
  fs.closeSync(fs.openSync(target, 'w'))
  originalWriteFileSync(armed, '')
  throw new Error('heartbeat write interrupted')
}`

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('fixture never reached an interrupted heartbeat write')
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('codex inline live block fixture heartbeat', () => {
  let child: ChildProcess | null = null
  let directory: string | null = null

  afterEach(async () => {
    if (child && child.exitCode === null) {
      const exited = new Promise((resolve) => child?.once('exit', resolve))
      child.kill('SIGKILL')
      await exited
    }
    child = null
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
      directory = null
    }
  })

  it('never publishes a truncated heartbeat when a write is interrupted', async () => {
    directory = mkdtempSync(path.join(tmpdir(), 'orca-inline-heartbeat-'))
    const publishedPath = path.join(directory, 'heartbeat.txt')
    const armedPath = path.join(directory, 'armed')
    const preloadPath = path.join(directory, 'interrupt-heartbeat-write.cjs')
    writeFileSync(preloadPath, INTERRUPTED_WRITE_PRELOAD)

    child = spawn(process.execPath, ['--require', preloadPath, FIXTURE_PATH, publishedPath], {
      env: {
        ...process.env,
        ORCA_HEARTBEAT_PUBLISHED: publishedPath,
        ORCA_HEARTBEAT_ARMED: armedPath
      },
      stdio: 'ignore'
    })

    await waitFor(() => existsSync(armedPath))

    // Sample across several further interrupted ticks: the published frame may
    // go stale, but it must never become unreadable.
    for (let sample = 0; sample < 8; sample += 1) {
      expect(readFileSync(publishedPath, 'utf8').trim()).toMatch(/^[1-9]\d*$/)
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
  })
})

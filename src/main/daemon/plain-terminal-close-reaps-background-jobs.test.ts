import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createPtySubprocess } from './pty-subprocess'
import { Session } from './session'
import { TerminalSessionTeardown } from './terminal-session-teardown'

const hasBash = process.platform !== 'win32' && spawnSync('/bin/bash', ['--version']).status === 0
const POLL_CEILING_MS = 10_000

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function pollUntil(predicate: () => boolean, ceilingMs: number): Promise<boolean> {
  const deadline = Date.now() + ceilingMs
  while (Date.now() < deadline) {
    if (predicate()) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return predicate()
}

describe.skipIf(!hasBash)('closing a plain daemon terminal (ORCA-678)', () => {
  const cleanups: (() => void)[] = []

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) {
      try {
        cleanup()
      } catch {
        /* best-effort */
      }
    }
  })

  it.each([false, true])(
    'terminates a nohup background poller (immediate=%s)',
    async (immediate) => {
      const dir = mkdtempSync(join(tmpdir(), 'orca-678-'))
      cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
      const pidFile = join(dir, 'poller.pid')
      const subprocess = createPtySubprocess({
        sessionId: 'orca-678-plain',
        cols: 80,
        rows: 24,
        cwd: dir,
        shellOverride: '/bin/bash',
        env: {
          HOME: dir,
          PATH: process.env.PATH ?? '/usr/bin:/bin',
          SHELL: '/bin/bash',
          TERM: 'xterm-256color'
        }
      })
      const session = new Session({
        sessionId: 'orca-678-plain',
        cols: 80,
        rows: 24,
        subprocess,
        shellReadySupported: false
      })
      cleanups.push(() => session.dispose())
      session.attachClient({ onData: () => {}, onExit: () => {} })

      session.write(`nohup sleep 300 >/dev/null 2>&1 & echo $! > ${pidFile}\r`)
      expect(await pollUntil(() => existsSync(pidFile), POLL_CEILING_MS)).toBe(true)
      const pollerPid = Number(readFileSync(pidFile, 'utf8').trim())
      expect(pollerPid).toBeGreaterThan(0)
      cleanups.push(() => {
        if (isProcessAlive(pollerPid)) {
          process.kill(pollerPid, 'SIGKILL')
        }
      })
      expect(isProcessAlive(pollerPid)).toBe(true)

      await new TerminalSessionTeardown(new Map([['orca-678-plain', session]])).killSession(
        'orca-678-plain',
        session,
        immediate
      )

      expect(await pollUntil(() => !session.isAlive, POLL_CEILING_MS)).toBe(true)
      expect(await pollUntil(() => !isProcessAlive(pollerPid), POLL_CEILING_MS)).toBe(true)
    },
    30_000
  )
})

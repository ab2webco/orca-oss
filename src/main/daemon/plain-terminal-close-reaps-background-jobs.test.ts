import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { describeProcessForFailure, processRunState } from '../pty/process-run-state-test-harness'
import { createPtySubprocess } from './pty-subprocess'
import { Session } from './session'
import { TerminalSessionTeardown } from './terminal-session-teardown'

const hasBash = process.platform !== 'win32' && spawnSync('/bin/bash', ['--version']).status === 0
const POLL_CEILING_MS = 10_000

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
        if (processRunState(pollerPid) === 'running') {
          process.kill(pollerPid, 'SIGKILL')
        }
      })
      expect(processRunState(pollerPid)).toBe('running')

      await new TerminalSessionTeardown(new Map([['orca-678-plain', session]])).killSession(
        'orca-678-plain',
        session,
        immediate
      )

      expect(await pollUntil(() => !session.isAlive, POLL_CEILING_MS)).toBe(true)
      // Why: the killed poller is reparented to init and stays a zombie until init reaps it.
      const pollerEnded = await pollUntil(
        () => processRunState(pollerPid) !== 'running',
        POLL_CEILING_MS
      )
      expect(pollerEnded, pollerEnded ? '' : describeProcessForFailure(pollerPid)).toBe(true)
    },
    30_000
  )
})

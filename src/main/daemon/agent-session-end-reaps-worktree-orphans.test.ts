import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { describeProcessForFailure, processRunState } from '../pty/process-run-state-test-harness'
import { createPtySubprocess } from './pty-subprocess'
import { Session } from './session'
import { TerminalSessionTeardown } from './terminal-session-teardown'

const hasBash = process.platform !== 'win32' && spawnSync('/bin/bash', ['--version']).status === 0
const POLL_CEILING_MS = 15_000

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

type EndSession = (session: Session, sessionId: string) => Promise<void> | void

describe.skipIf(!hasBash)('an agent session that ends (ORCA-678 2/3)', () => {
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

  const endings: [string, EndSession][] = [
    ['the shell exits on its own', (session) => session.write('exit\r')],
    [
      'the session is closed',
      (session, sessionId) =>
        new TerminalSessionTeardown(new Map([[sessionId, session]])).killSession(
          sessionId,
          session,
          false
        )
    ]
  ]

  it.each(endings)(
    'leaves no orphaned poller with a cwd inside its worktree when %s',
    async (_label, endSession) => {
      const dir = mkdtempSync(join(tmpdir(), 'orca-678-agent-'))
      cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
      const pidFile = join(dir, 'poller.pid')
      const sessionId = 'orca-678-agent'
      const subprocess = createPtySubprocess({
        sessionId,
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
        sessionId,
        cols: 80,
        rows: 24,
        launchAgent: 'claude',
        subprocess,
        shellReadySupported: false
      })
      cleanups.push(() => session.dispose())
      session.attachClient({ onData: () => {}, onExit: () => {} })

      // Why: the subshell exits at once, so the poller is reparented before the session ends
      // and no ppid walk from the shell can reach it.
      session.write(`( nohup sleep 300 >/dev/null 2>&1 & echo $! > ${pidFile} )\r`)
      expect(await pollUntil(() => existsSync(pidFile), POLL_CEILING_MS)).toBe(true)
      const pollerPid = Number(readFileSync(pidFile, 'utf8').trim())
      expect(pollerPid).toBeGreaterThan(0)
      cleanups.push(() => {
        if (processRunState(pollerPid) === 'running') {
          process.kill(pollerPid, 'SIGKILL')
        }
      })
      expect(processRunState(pollerPid)).toBe('running')
      // Why: same cwd and start window, but its parent (this test) is alive, so it has an owner.
      const owned = spawn('sleep', ['300'], { cwd: dir, stdio: 'ignore' })
      cleanups.push(() => owned.kill('SIGKILL'))
      const ownedPid = owned.pid ?? 0
      expect(ownedPid).toBeGreaterThan(0)

      await endSession(session, sessionId)

      expect(await pollUntil(() => !session.isAlive, POLL_CEILING_MS)).toBe(true)
      // Why: a killed orphan stays a zombie until init reaps it, which this test cannot bound.
      const pollerEnded = await pollUntil(
        () => processRunState(pollerPid) !== 'running',
        POLL_CEILING_MS
      )
      expect(pollerEnded, pollerEnded ? '' : describeProcessForFailure(pollerPid)).toBe(true)
      // Past the sweep's SIGKILL grace window, the owned process must still be running.
      await new Promise((resolve) => setTimeout(resolve, 2_500))
      expect(processRunState(ownedPid)).toBe('running')
      expect(owned.signalCode).toBeNull()
    },
    45_000
  )
})

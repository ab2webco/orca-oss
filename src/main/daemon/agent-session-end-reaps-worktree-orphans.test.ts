import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createPtySubprocess } from './pty-subprocess'
import { Session } from './session'
import { TerminalSessionTeardown } from './terminal-session-teardown'

const hasBash = process.platform !== 'win32' && spawnSync('/bin/bash', ['--version']).status === 0
const POLL_CEILING_MS = 15_000

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
        if (isProcessAlive(pollerPid)) {
          process.kill(pollerPid, 'SIGKILL')
        }
      })
      expect(isProcessAlive(pollerPid)).toBe(true)

      await endSession(session, sessionId)

      expect(await pollUntil(() => !session.isAlive, POLL_CEILING_MS)).toBe(true)
      expect(await pollUntil(() => !isProcessAlive(pollerPid), POLL_CEILING_MS)).toBe(true)
    },
    45_000
  )
})

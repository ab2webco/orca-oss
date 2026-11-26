import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as pty from 'node-pty'
import { afterEach, describe, expect, it } from 'vitest'
import type { RuntimeTerminalSend } from '../../shared/runtime-types'
import type { ClaudeTerminalSwitchCapture } from '../claude-accounts/atomic-terminal-account-switch'
import {
  buildClaudeTerminalAccountSwitchPorts,
  type ClaudeTerminalAccountSwitchServices
} from './claude-terminal-account-switch-ports'
import type { OrcaRuntimeService } from './orca-runtime'

/**
 * ORCA-1347: a member stopped at Claude's usage-limit menu rolled back after the
 * 90 s verify. The stop worked; the resumed Claude, launched against a target
 * vault that had never trusted the folder, sat on the trust dialog, which fires
 * no SessionStart hook. The fake below enforces trust the way Claude 2.1.332 does.
 */
const MENU_MARKER = 'FAKE_CLAUDE_LIMIT_MENU'
const MENU_CLOSED_MARKER = 'FAKE_CLAUDE_MENU_CLOSED'
const QUIT_MARKER = 'FAKE_CLAUDE_QUIT'
const TRUST_DIALOG_MARKER = 'Accessing workspace:'
const SESSION_START_MARKER = 'FAKE_CLAUDE_SESSION_START'

const hasBash = process.platform !== 'win32' && spawnSync('bash', ['--version']).status === 0
const itWithBash = hasBash ? it : it.skip

const FAKE_CLAUDE = `const fs = require('node:fs')
const path = require('node:path')
process.stdin.setRawMode(true)
process.stdin.resume()
process.on('SIGINT', () => {})
if (process.argv[2] === 'resume') {
  let trusted = false
  try {
    const config = JSON.parse(
      fs.readFileSync(path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json'), 'utf8')
    )
    trusted = config.projects?.[process.cwd()]?.hasTrustDialogAccepted === true
  } catch {}
  // Claude runs its SessionStart hooks only once the folder is trusted.
  process.stdout.write(
    (trusted ? '${SESSION_START_MARKER}' : '${TRUST_DIALOG_MARKER} ' + process.cwd()) + '\\r\\n'
  )
} else {
  process.stdout.write(
    'What do you want to do?\\r\\n  1. Stop and wait for limit to reset\\r\\n' +
      '  2. Wait here, then continue automatically when the limit resets\\r\\n' +
      '  3. Switch to usage credits\\r\\n  4. Upgrade your plan\\r\\n${MENU_MARKER}\\r\\n'
  )
}
// Why the menu eats a press: its onCancel takes the first Ctrl+C before the
// TUI's own "press again to exit" contract sees one.
let menuOpen = process.argv[2] !== 'resume'
let armedAt = 0
process.stdin.on('data', (chunk) => {
  for (const byte of chunk) {
    if (byte !== 0x03) continue
    if (menuOpen) {
      menuOpen = false
      process.stdout.write('${MENU_CLOSED_MARKER}\\r\\n')
      continue
    }
    const now = Date.now()
    if (armedAt !== 0 && now - armedAt <= 2000) {
      process.stdout.write('${QUIT_MARKER}\\r\\n')
      process.exit(0)
    }
    armedAt = now
  }
})
`

const cleanups: (() => void)[] = []

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.()
  }
})

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for the PTY to reach the expected state')
    }
    await delay(50)
  }
}

/** A real shell pane whose foreground is the fake Claude stopped at its usage-limit menu. */
async function startMemberAtLimitMenu() {
  const root = mkdtempSync(join(tmpdir(), 'orca-1347-'))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  const worktree = join(root, 'worktree')
  const targetVault = join(root, 'target-vault')
  mkdirSync(worktree)
  mkdirSync(targetVault)
  writeFileSync(join(targetVault, '.claude.json'), '{"hasCompletedOnboarding":true}\n')
  const scriptPath = join(root, 'fake-claude.cjs')
  writeFileSync(scriptPath, FAKE_CLAUDE)

  const proc = pty.spawn('bash', ['--noprofile', '--norc', '-i'], {
    name: 'xterm-256color',
    cols: 100,
    rows: 30,
    cwd: worktree,
    env: { ...process.env, PS1: '$ ' } as Record<string, string>
  })
  cleanups.push(() => {
    try {
      proc.kill('SIGKILL')
    } catch {
      // The pane may already be gone.
    }
  })
  let transcript = ''
  proc.onData((data) => {
    transcript += data
  })
  const runtime = {
    sendTerminal: async (
      handle: string,
      action: { text?: string; enter?: boolean; interrupt?: boolean }
    ) => {
      const payload = `${action.text ?? ''}${action.enter ? '\r' : ''}${action.interrupt ? '\x03' : ''}`
      proc.write(payload)
      return {
        handle,
        accepted: true,
        bytesWritten: Buffer.byteLength(payload)
      } satisfies RuntimeTerminalSend
    },
    inspectTerminalProcess: async () => ({
      foregroundProcess: proc.process,
      hasChildProcesses: proc.process !== 'bash'
    })
  } as unknown as OrcaRuntimeService

  proc.write(`"${process.execPath}" "${scriptPath}" menu\n`)
  await waitFor(() => transcript.includes(MENU_MARKER))
  await waitFor(() => proc.process !== 'bash')

  const capture: ClaudeTerminalSwitchCapture = {
    operationId: 'claude-switch-orca-1347',
    terminal: 'term_limit_menu',
    ptyId: 'pty-orca-1347',
    paneKey: null,
    sourceAccountId: 'source-account',
    targetAccountId: 'target-account',
    runtime: 'host',
    wslDistro: null,
    cwd: worktree,
    sessionId: 'session-orca-1347',
    launchConfig: { agentCommand: 'claude', agentArgs: '', agentEnv: {} },
    platform: process.platform,
    shell: 'posix',
    capturedAt: 0
  }
  const attached = {
    getSettings: () => ({ claudeManagedAccounts: [] }),
    prepareClaudeAuth: async () => {
      throw new Error('not used')
    }
  } as unknown as ClaudeTerminalAccountSwitchServices
  const ports = buildClaudeTerminalAccountSwitchPorts(runtime, attached, capture, () => {})
  const resumeOnTarget = (): void => {
    proc.write(`CLAUDE_CONFIG_DIR="${targetVault}" "${process.execPath}" "${scriptPath}" resume\n`)
  }
  return {
    ports,
    capture,
    targetVault,
    resumeOnTarget,
    transcript: () => transcript,
    foreground: () => proc.process
  }
}

describe('account switch on a member stopped at the usage-limit menu', () => {
  itWithBash(
    'stops the source from the menu and resumes the target past its trust dialog',
    async () => {
      const member = await startMemberAtLimitMenu()

      expect(await member.ports.stopSource(member.capture)).toBe(true)
      expect(member.transcript()).toContain(MENU_CLOSED_MARKER)
      await waitFor(() => member.transcript().includes(QUIT_MARKER), 5_000)
      expect(member.foreground()).toBe('bash')

      expect(
        await member.ports.trustTargetFolder({
          capture: member.capture,
          configDir: member.targetVault
        })
      ).toBe(true)
      member.resumeOnTarget()
      await waitFor(
        () =>
          member.transcript().includes(SESSION_START_MARKER) ||
          member.transcript().includes(`${TRUST_DIALOG_MARKER} /`)
      )
      expect(member.transcript()).toContain(SESSION_START_MARKER)
    }
  )

  itWithBash(
    'without the trust step the target stops on the trust dialog, the 90 s timeout of ORCA-1347',
    async () => {
      const member = await startMemberAtLimitMenu()

      expect(await member.ports.stopSource(member.capture)).toBe(true)
      member.resumeOnTarget()
      await waitFor(() => member.transcript().includes(`${TRUST_DIALOG_MARKER} /`))
      expect(member.transcript()).not.toContain(SESSION_START_MARKER)
    }
  )
})

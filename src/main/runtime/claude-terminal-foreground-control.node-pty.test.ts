import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as pty from 'node-pty'
import { afterEach, describe, expect, it } from 'vitest'
import type { RuntimeTerminalSend } from '../../shared/runtime-types'
import type { ClaudeTerminalSwitchCapture } from '../claude-accounts/atomic-terminal-account-switch'
import {
  stopClaudeTerminalForegroundAgent,
  type ClaudeTerminalForegroundRuntime
} from './claude-terminal-foreground-control'

/**
 * The switch's stop step was only ever proven against port mocks that resolved
 * "the agent exited" on demand (ORCA-167). These cases run it against a real
 * PTY hosting a TUI that honors the real Claude quit contract: Ctrl+C is a
 * keystroke, not a signal, and only a second press inside the arm window quits.
 */
const ARM_WINDOW_MS = 2_000
const READY_MARKER = 'FAKE_CLAUDE_READY'
const QUIT_MARKER = 'FAKE_CLAUDE_QUIT'
const CLEARED_MARKER = 'FAKE_CLAUDE_INPUT_CLEARED'
const HINT = 'Press Ctrl-C again to exit'

const describePosix = process.platform === 'win32' ? describe.skip : describe
const hasBash = process.platform !== 'win32' && spawnSync('bash', ['--version']).status === 0
const itWithBash = hasBash ? it : it.skip

const FAKE_CLAUDE_TUI = `const ARM_WINDOW_MS = ${ARM_WINDOW_MS}
let armedAt = 0
let pendingInput = process.argv[2] === 'dirty'
// Why raw mode: it clears ISIG, so the tty never turns \\x03 into SIGINT — the
// same reason a single interrupt cannot kill a real Claude TUI.
process.stdin.setRawMode(true)
process.stdin.resume()
process.on('SIGINT', () => {})
process.stdout.write('${READY_MARKER}\\r\\n')
process.stdin.on('data', (chunk) => {
  for (const byte of chunk) {
    if (byte !== 0x03) {
      continue
    }
    // A composer holding typed text spends the first press clearing it, so that
    // press neither arms the exit nor prints the hint.
    if (pendingInput) {
      pendingInput = false
      process.stdout.write('${CLEARED_MARKER}\\r\\n')
      continue
    }
    const now = Date.now()
    if (armedAt !== 0 && now - armedAt <= ARM_WINDOW_MS) {
      process.stdout.write('${QUIT_MARKER} gap=' + (now - armedAt) + '\\r\\n')
      process.exit(0)
    }
    armedAt = now
    process.stdout.write('${HINT}\\r\\n')
  }
})
`

type LivePane = {
  runtime: ClaudeTerminalForegroundRuntime
  transcript(): string
  foreground(): string
  dispose(): void
}

const panes: LivePane[] = []
const tempDirs: string[] = []

afterEach(() => {
  while (panes.length > 0) {
    panes.pop()?.dispose()
  }
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true })
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

/** Starts a real PTY whose foreground job is the fake Claude TUI. */
async function startPaneRunningFakeClaude(
  options: { dirtyInput?: boolean } = {}
): Promise<LivePane> {
  const dir = mkdtempSync(join(tmpdir(), 'orca-claude-stop-'))
  tempDirs.push(dir)
  const scriptPath = join(dir, 'fake-claude-tui.cjs')
  writeFileSync(scriptPath, FAKE_CLAUDE_TUI)

  const shell = 'bash'
  const proc = pty.spawn(shell, ['--noprofile', '--norc', '-i'], {
    name: 'xterm-256color',
    cols: 100,
    rows: 30,
    cwd: dir,
    env: { ...process.env, PS1: '$ ' } as Record<string, string>
  })

  let transcript = ''
  proc.onData((data) => {
    transcript += data
  })

  const pane: LivePane = {
    // Why not a port mock: both effects go through the real PTY, so the stop
    // only "works" if the keystrokes really quit the TUI and the foreground
    // really transitions back to the shell.
    runtime: {
      sendTerminal: async (_handle, action): Promise<RuntimeTerminalSend> => {
        const payload = `${action.text ?? ''}${action.enter ? '\r' : ''}${action.interrupt ? '\x03' : ''}`
        proc.write(payload)
        return { handle: _handle, accepted: true, bytesWritten: Buffer.byteLength(payload) }
      },
      // Mirrors LocalPtyProvider: both facts derive from the tty's foreground
      // process group, compared against the shell the pane spawned.
      inspectTerminalProcess: async () => ({
        foregroundProcess: proc.process,
        hasChildProcesses: proc.process !== shell
      })
    },
    transcript: () => transcript,
    foreground: () => proc.process,
    dispose: () => {
      try {
        proc.kill('SIGKILL')
      } catch {
        // The pane may already be gone.
      }
    }
  }
  panes.push(pane)

  // Job control gives the foreground job its own process group, which is what
  // makes the pane's foreground observable the way a real Orca pane's is.
  proc.write(`"${process.execPath}" "${scriptPath}" ${options.dirtyInput ? 'dirty' : 'idle'}\n`)
  await waitFor(() => transcript.includes(READY_MARKER))
  await waitFor(() => proc.process !== shell)
  return pane
}

function captureFor(terminal: string): ClaudeTerminalSwitchCapture {
  return {
    operationId: 'claude-switch-orca-167',
    terminal,
    ptyId: 'pty-orca-167',
    paneKey: null,
    sourceAccountId: 'source-account',
    targetAccountId: 'target-account',
    runtime: 'host',
    wslDistro: null,
    cwd: '/tmp/orca-167',
    sessionId: 'session-orca-167',
    launchConfig: { agentCommand: 'claude', agentArgs: '', agentEnv: {} },
    platform: process.platform,
    shell: 'posix',
    capturedAt: 0
  }
}

describePosix('stopClaudeTerminalForegroundAgent against a live PTY', () => {
  itWithBash('quits a TUI that only exits on a second Ctrl+C inside the arm window', async () => {
    const pane = await startPaneRunningFakeClaude()

    const stopped = await stopClaudeTerminalForegroundAgent(pane.runtime, captureFor('term_live'))

    expect(stopped).toBe(true)
    expect(pane.transcript()).toContain(QUIT_MARKER)
    expect(pane.foreground()).toBe('bash')
  })

  itWithBash('retries the chord when the first press only clears typed input', async () => {
    const pane = await startPaneRunningFakeClaude({ dirtyInput: true })

    const stopped = await stopClaudeTerminalForegroundAgent(pane.runtime, captureFor('term_live'))

    expect(stopped).toBe(true)
    expect(pane.transcript()).toContain(CLEARED_MARKER)
    expect(pane.transcript()).toContain(QUIT_MARKER)
    expect(pane.foreground()).toBe('bash')
  })

  itWithBash('leaves the TUI running when only one Ctrl+C is delivered', async () => {
    const pane = await startPaneRunningFakeClaude()
    const foregroundBefore = pane.foreground()

    await pane.runtime.sendTerminal('term_live', { interrupt: true })
    await waitFor(() => pane.transcript().includes(HINT))
    await delay(ARM_WINDOW_MS / 2)

    expect(pane.transcript()).not.toContain(QUIT_MARKER)
    expect(pane.foreground()).toBe(foregroundBefore)
  })
})

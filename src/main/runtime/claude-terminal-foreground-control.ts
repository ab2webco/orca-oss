import { isShellProcess } from '../../shared/agent-detection'
import { recognizeAgentProcess } from '../../shared/agent-process-recognition'
import type { ClaudeTerminalSwitchCapture } from '../claude-accounts/atomic-terminal-account-switch'
import type { OrcaRuntimeService } from './orca-runtime'

const STOP_AGENT_TIMEOUT_MS = 20_000
const STOP_AGENT_ATTEMPT_MS = 6_000
const STOP_AGENT_POLL_MS = 250
const SOURCE_FOREGROUND_TIMEOUT_MS = 15_000
/**
 * The switch is accepted before this runs, so the self-switching agent's tool
 * subprocess has already been told the outcome and is exiting. PTY inspection
 * cannot see that subprocess at all — Claude spawns tools off the PTY, so the
 * pane's foreground stays `claude` either way — which is exactly why this waits
 * out one bounded grace instead of polling for the child to disappear.
 */
const CALLER_EXIT_GRACE_MS = 1_000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForShellForeground(
  runtime: OrcaRuntimeService,
  capture: ClaudeTerminalSwitchCapture,
  deadline: number
): Promise<boolean> {
  for (;;) {
    let inspection: Awaited<ReturnType<OrcaRuntimeService['inspectTerminalProcess']>>
    try {
      inspection = await runtime.inspectTerminalProcess(capture.terminal)
    } catch {
      return false
    }
    if (
      !inspection.unavailable &&
      !inspection.hasChildProcesses &&
      inspection.foregroundProcess &&
      isShellProcess(inspection.foregroundProcess)
    ) {
      return true
    }
    if (Date.now() >= deadline) {
      return false
    }
    await delay(STOP_AGENT_POLL_MS)
  }
}

/**
 * Waits until the agent itself owns the terminal again, before a self-switch
 * interrupts it. The Ctrl+C lands on the whole foreground process group, which
 * is where the invoking tool call lives, so firing it immediately would kill the
 * caller mid-report and could cancel only that tool instead of ending the turn.
 */
export async function awaitClaudeTerminalSourceForeground(
  runtime: OrcaRuntimeService,
  capture: ClaudeTerminalSwitchCapture
): Promise<boolean> {
  await delay(CALLER_EXIT_GRACE_MS)
  const deadline = Date.now() + SOURCE_FOREGROUND_TIMEOUT_MS
  for (;;) {
    try {
      const inspection = await runtime.inspectTerminalProcess(capture.terminal)
      if (
        !inspection.unavailable &&
        recognizeAgentProcess(inspection.foregroundProcess)?.agent === 'claude'
      ) {
        return true
      }
    } catch {
      // The pane died with the caller; there is no agent left to interrupt.
      return false
    }
    if (Date.now() >= deadline) {
      return false
    }
    await delay(STOP_AGENT_POLL_MS)
  }
}

/** Ctrl+C the foreground agent and wait until the shell owns the terminal again. */
export async function stopClaudeTerminalForegroundAgent(
  runtime: OrcaRuntimeService,
  capture: ClaudeTerminalSwitchCapture
): Promise<boolean> {
  const deadline = Date.now() + STOP_AGENT_TIMEOUT_MS
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await runtime.sendTerminal(capture.terminal, { interrupt: true })
    } catch {
      return false
    }
    if (
      await waitForShellForeground(
        runtime,
        capture,
        Math.min(deadline, Date.now() + STOP_AGENT_ATTEMPT_MS)
      )
    ) {
      return true
    }
    if (Date.now() >= deadline) {
      return false
    }
  }
  return false
}

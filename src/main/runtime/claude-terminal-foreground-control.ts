import { isShellProcess } from '../../shared/agent-detection'
import type { ClaudeTerminalSwitchCapture } from '../claude-accounts/atomic-terminal-account-switch'
import type { OrcaRuntimeService } from './orca-runtime'

const STOP_AGENT_TIMEOUT_MS = 20_000
const STOP_AGENT_ATTEMPT_MS = 6_000
const STOP_AGENT_POLL_MS = 250

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
    await new Promise((resolve) => setTimeout(resolve, STOP_AGENT_POLL_MS))
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

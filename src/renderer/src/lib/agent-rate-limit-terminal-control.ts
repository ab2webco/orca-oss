import type { AutoSwitchRateLimitAgent } from '../../../shared/agent-rate-limit-detection'
import type { GlobalSettings } from '../../../shared/types'
import { isExpectedAgentProcess } from '../../../shared/agent-process-recognition'
import {
  inspectRuntimeTerminalProcess,
  sendRuntimePtyInputVerified
} from '@/runtime/runtime-terminal-inspection'

const AGENT_STOP_ATTEMPTS = 3
const AGENT_STOP_WAIT_MS = 1400
// Why: Claude's "Press Ctrl+C again to exit" window is short; a second Ctrl+C
// must land inside it or it reads as a fresh first-press and never exits.
const AGENT_STOP_DOUBLE_INTERRUPT_MS = 120
const AGENT_RESUME_WAIT_MS = 6000
const AGENT_READY_INPUT_DELAY_MS = 800

/** Uses the browser timer so renderer tests and Electron share the same scheduling path. */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

/** Matches the foreground process against the expected resumed provider command. */
function isForegroundAgent(
  foregroundProcess: string | null | undefined,
  agent: AutoSwitchRateLimitAgent,
  expectedProcess: string
): boolean {
  if (isExpectedAgentProcess(foregroundProcess, expectedProcess)) {
    return true
  }
  const normalized = foregroundProcess?.trim().toLowerCase() ?? ''
  return agent === 'codex' ? normalized.startsWith('codex-') : normalized === 'claude'
}

/**
 * Tri-state foreground inspection: `unavailable` means the runtime cannot answer
 * a liveness probe (a daemon left running across an app update predates
 * inspectProcess), so stop/resume decisions must degrade instead of freezing.
 */
type ForegroundInspection = 'foreground' | 'not-foreground' | 'unavailable'

/**
 * True when an inspection error signals the executing runtime cannot answer a
 * liveness probe: the process-inspection version gate (`terminal_liveness_unavailable`)
 * or a pre-update daemon that never implemented the request
 * (`Unknown request type: inspectProcess`). Matched by message so it also holds
 * when relayed across the SSH/relay mux as a serialized error string.
 */
function isInspectionUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes('terminal_liveness_unavailable') || message.includes('Unknown request type')
  )
}

/** Inspects the PTY without mutating it, so stop/resume decisions stay terminal-safe. */
async function inspectAgentForeground(args: {
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined
  ptyId: string
  agent: AutoSwitchRateLimitAgent
  expectedProcess: string
}): Promise<ForegroundInspection> {
  let process: Awaited<ReturnType<typeof inspectRuntimeTerminalProcess>>
  try {
    process = await inspectRuntimeTerminalProcess(args.settings, args.ptyId)
  } catch (error) {
    if (isInspectionUnavailableError(error)) {
      return 'unavailable'
    }
    throw error
  }
  if (process.unavailable) {
    return 'unavailable'
  }
  return isForegroundAgent(process.foregroundProcess, args.agent, args.expectedProcess)
    ? 'foreground'
    : 'not-foreground'
}

/** Exits only the foreground agent process by sending Ctrl+C to the existing PTY. */
export async function stopForegroundAgent(args: {
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined
  ptyId: string
  agent: AutoSwitchRateLimitAgent
  expectedProcess: string
}): Promise<boolean> {
  const initial = await inspectAgentForeground(args)
  if (initial === 'not-foreground') {
    return true
  }

  for (let attempt = 0; attempt < AGENT_STOP_ATTEMPTS; attempt += 1) {
    // Why: send a rapid Ctrl+C pair — the first interrupts any in-flight
    // response (returning Claude to the prompt), the second lands inside the
    // "press again to exit" window and quits. A single Ctrl+C per attempt, with
    // the settle wait between attempts, never exits a busy or idle session.
    const first = await sendRuntimePtyInputVerified(args.settings, args.ptyId, '\x03')
    if (!first) {
      return false
    }
    await wait(AGENT_STOP_DOUBLE_INTERRUPT_MS)
    const second = await sendRuntimePtyInputVerified(args.settings, args.ptyId, '\x03')
    if (!second) {
      return false
    }
    await wait(AGENT_STOP_WAIT_MS)
    const check = await inspectAgentForeground(args)
    if (check === 'not-foreground') {
      return true
    }
    if (check === 'unavailable') {
      // Why: a daemon left running across an app update cannot report liveness,
      // so exit cannot be confirmed. The best-effort Ctrl+C pair above reliably
      // quits an idle rate-limited Claude; proceed with the switch rather than
      // freezing the agent on the exhausted account. This is the safe default —
      // both switch flavors relaunch/resume after the stop, so an unconfirmed
      // stop degrades to "continue on the fallback account", never a hard fail.
      return true
    }
  }

  return false
}

/** Waits for the resumed provider process to take foreground control of the same PTY. */
export async function waitForResumedAgent(args: {
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined
  ptyId: string
  agent: AutoSwitchRateLimitAgent
  expectedProcess: string
}): Promise<boolean> {
  const deadline = Date.now() + AGENT_RESUME_WAIT_MS
  let inspectionUnavailable = false
  while (Date.now() < deadline) {
    const inspection = await inspectAgentForeground(args)
    if (inspection === 'foreground') {
      return true
    }
    if (inspection === 'unavailable') {
      inspectionUnavailable = true
    }
    await wait(150)
  }
  // Why: a daemon left running across an app update cannot confirm the resumed
  // agent took foreground. After the normal wait window (giving the resume time
  // to boot), assume it launched so the continue step proceeds — degrading
  // gracefully instead of aborting an otherwise-successful switch.
  return inspectionUnavailable
}

/** Leaves a short settle window before sending the continuation prompt to the TUI. */
export async function waitForAgentReadyInput(): Promise<void> {
  await wait(AGENT_READY_INPUT_DELAY_MS)
}

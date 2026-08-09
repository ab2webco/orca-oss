import type {
  ClaudeTerminalAccountSwitchAcceptance,
  ClaudeTerminalAccountSwitchFailureReason,
  ClaudeTerminalAccountSwitchRequest,
  ClaudeTerminalAccountSwitchResult,
  ClaudeTerminalSwitchReadiness
} from '../../shared/claude-terminal-account-switch'
import type { SleepingAgentLaunchConfig } from '../../shared/agent-session-resume'
import type { ClaudeTerminalSwitchCapture } from '../claude-accounts/atomic-terminal-account-switch'
import { runAtomicClaudeTerminalAccountSwitch } from '../claude-accounts/atomic-terminal-account-switch'
import { resolveClaudeTerminalSwitchReadiness } from '../claude-accounts/claude-terminal-switch-readiness'
import {
  buildClaudeTerminalAccountSwitchPorts,
  resolveClaudeTerminalSwitchShell,
  resolvePtyClaudeAccountId,
  type ClaudeTerminalAccountSwitchServices
} from './claude-terminal-account-switch-ports'
import type { OrcaRuntimeService, RuntimeClaudeTerminalSwitchSnapshot } from './orca-runtime'

export type { ClaudeTerminalAccountSwitchServices }

const OPERATION_HISTORY_LIMIT = 64

let services: ClaudeTerminalAccountSwitchServices | null = null
let operationSeq = 0

/**
 * Attaches the desktop-only account services the switch needs. Headless
 * `orca serve` never calls it, so the RPC fails with `runtime-unavailable`
 * instead of half-executing a transaction it cannot finish.
 */
export function attachClaudeTerminalAccountSwitchServices(
  next: ClaudeTerminalAccountSwitchServices | null
): void {
  services = next
}

type OperationRecord = {
  operationId: string
  result: ClaudeTerminalAccountSwitchResult
  settled: Promise<ClaudeTerminalAccountSwitchResult>
}

/**
 * Resolves as soon as the transaction leaves preflight — everything after that
 * point is destructive and no longer needs the caller. A self-switching agent
 * waits for exactly this: it must learn whether its switch was refused, then
 * exit so the interrupt does not land on its own tool subprocess.
 */
export type ClaudeTerminalAccountSwitchPastPreflight = Promise<void>

const operations = new Map<string, OperationRecord>()

export class ClaudeTerminalAccountSwitchRefusal extends Error {
  constructor(readonly reason: ClaudeTerminalAccountSwitchFailureReason) {
    super(reason)
    this.name = 'ClaudeTerminalAccountSwitchRefusal'
  }
}

function pruneOperations(): void {
  while (operations.size > OPERATION_HISTORY_LIMIT) {
    const oldest = operations.keys().next()
    if (oldest.done) {
      return
    }
    operations.delete(oldest.value)
  }
}

type ClaudeTerminalSwitchTargetSnapshot =
  | RuntimeClaudeTerminalSwitchSnapshot
  | { ok: false; reason: 'terminal-not-found' }
  | null

type ClaudeTerminalSwitchPreflightOutcome =
  | {
      state: 'ready'
      services: ClaudeTerminalAccountSwitchServices
      target: RuntimeClaudeTerminalSwitchSnapshot
      sourceAccountId: string
      sessionId: string
      cwd: string
      launchConfig: SleepingAgentLaunchConfig
    }
  | { state: 'unavailable'; reason: ClaudeTerminalAccountSwitchFailureReason }

/**
 * The one place the switch's admission rules live. It both refuses a switch and
 * answers "could this pane be switched" for the account report, so the report
 * can never call a pane ready that the switch would then turn away.
 */
function runClaudeTerminalSwitchPreflight(
  attached: ClaudeTerminalAccountSwitchServices | null,
  snapshot: ClaudeTerminalSwitchTargetSnapshot
): ClaudeTerminalSwitchPreflightOutcome {
  const target = snapshot?.ok === true ? snapshot : null
  const sourceAccountId =
    attached && target ? resolvePtyClaudeAccountId(attached, target.ptyId) : null
  const readiness = resolveClaudeTerminalSwitchReadiness({
    servicesAttached: attached !== null,
    paneResolved: target !== null,
    isWsl: target?.isWsl === true,
    remoteConnectionId: target?.remoteConnectionId ?? null,
    cwd: target?.cwd ?? null,
    sourceAccountId,
    providerSessionId: target?.providerSession?.id ?? null,
    launchConfig: target?.launchConfig
  })
  if (readiness.state === 'unavailable') {
    return { state: 'unavailable', reason: readiness.reason }
  }
  if (
    !attached ||
    !target ||
    !sourceAccountId ||
    !target.cwd ||
    !target.providerSession ||
    !target.launchConfig
  ) {
    // Why unreachable-but-present: readiness answers a question, it does not narrow
    // types. This keeps the capture's non-null reads honest without a cast.
    return { state: 'unavailable', reason: 'terminal-not-found' }
  }
  return {
    state: 'ready',
    services: attached,
    target,
    sourceAccountId,
    sessionId: target.providerSession.id,
    cwd: target.cwd,
    launchConfig: target.launchConfig
  }
}

/**
 * Reads whether a pane could be account-switched right now, without touching it.
 * Reported by `orca account list` so a pane that lost a prerequisite to a restart
 * says so before anyone asks for a switch (ORCA-187).
 */
export function readClaudeTerminalSwitchReadiness(
  snapshot: ClaudeTerminalSwitchTargetSnapshot
): ClaudeTerminalSwitchReadiness {
  const preflight = runClaudeTerminalSwitchPreflight(services, snapshot)
  return preflight.state === 'ready' ? { state: 'ready' } : preflight
}

/**
 * Captures the terminal, registers the operation, and returns acceptance BEFORE
 * any destructive work. The transaction then runs detached, so a self-switching
 * agent's dying tool subprocess — or a dropped CLI socket — cannot cancel it.
 */
export async function startClaudeTerminalAccountSwitch(
  runtime: OrcaRuntimeService,
  request: ClaudeTerminalAccountSwitchRequest
): Promise<{
  acceptance: ClaudeTerminalAccountSwitchAcceptance
  settled: Promise<ClaudeTerminalAccountSwitchResult>
  pastPreflight: ClaudeTerminalAccountSwitchPastPreflight
}> {
  const attached = services
  const snapshot = attached
    ? await runtime.snapshotClaudeTerminalSwitchTarget(request.target)
    : null
  const preflight = runClaudeTerminalSwitchPreflight(attached, snapshot)
  if (preflight.state === 'unavailable') {
    throw new ClaudeTerminalAccountSwitchRefusal(preflight.reason)
  }
  const { services: ready, target, sourceAccountId, sessionId, cwd, launchConfig } = preflight

  const capture: ClaudeTerminalSwitchCapture = {
    operationId: `claude-switch-${++operationSeq}-${Date.now()}`,
    terminal: target.terminal,
    ptyId: target.ptyId,
    paneKey: target.paneKey,
    sourceAccountId,
    targetAccountId: request.targetAccountId,
    runtime: 'host',
    wslDistro: null,
    cwd,
    sessionId,
    launchConfig,
    platform: process.platform,
    shell: resolveClaudeTerminalSwitchShell({
      isWsl: target.isWsl,
      terminalWindowsShell: ready.getSettings().terminalWindowsShell
    }),
    capturedAt: Date.now()
  }

  const acceptance: ClaudeTerminalAccountSwitchAcceptance = {
    operationId: capture.operationId,
    state: 'preflighting',
    terminal: capture.terminal,
    ptyId: capture.ptyId,
    sourceAccountId: capture.sourceAccountId,
    targetAccountId: capture.targetAccountId,
    sessionId: capture.sessionId,
    selfSwitch: request.selfSwitch === true
  }
  const initial: ClaudeTerminalAccountSwitchResult = {
    operationId: capture.operationId,
    state: 'preflighting',
    terminal: capture.terminal,
    ptyId: capture.ptyId,
    sourceAccountId: capture.sourceAccountId,
    targetAccountId: capture.targetAccountId,
    sessionId: capture.sessionId
  }

  const record: OperationRecord = {
    operationId: capture.operationId,
    result: initial,
    settled: Promise.resolve(initial)
  }
  operations.set(capture.operationId, record)
  pruneOperations()

  let leavePreflight = (): void => {}
  const pastPreflight = new Promise<void>((resolve) => {
    leavePreflight = resolve
  })
  const ports = buildClaudeTerminalAccountSwitchPorts(runtime, ready, capture, (state) => {
    record.result = { ...record.result, state }
    if (state !== 'preflighting') {
      leavePreflight()
    }
  })
  record.settled = runAtomicClaudeTerminalAccountSwitch(request, ports)
    .then((result) => {
      record.result = result
      return result
    })
    .catch((error: unknown) => {
      const failed: ClaudeTerminalAccountSwitchResult = {
        ...record.result,
        state: 'rollback-failed',
        failure: {
          reason: 'prepare-failed',
          message: error instanceof Error ? error.message : String(error)
        },
        recovery: {
          accountId: capture.sourceAccountId,
          sessionId: capture.sessionId,
          terminal: capture.terminal,
          ptyId: capture.ptyId
        }
      }
      record.result = failed
      return failed
    })
  // Why: the operation owns its own lifetime; an unobserved rejection here would
  // otherwise surface as an unhandled rejection when the caller walks away.
  void record.settled
  // A refusal that never left preflight still has to release the caller.
  void record.settled.then(leavePreflight)

  return { acceptance, settled: record.settled, pastPreflight }
}

export function getClaudeTerminalAccountSwitchStatus(
  operationId: string
): ClaudeTerminalAccountSwitchResult | null {
  return operations.get(operationId)?.result ?? null
}

/** Test seam: operation history is process-global, like the PTY binding registry. */
export function resetClaudeTerminalAccountSwitchOperations(): void {
  operations.clear()
  operationSeq = 0
}

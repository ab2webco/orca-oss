import type {
  ClaudeTerminalAccountSwitchAcceptance,
  ClaudeTerminalAccountSwitchFailureReason,
  ClaudeTerminalAccountSwitchRequest,
  ClaudeTerminalAccountSwitchResult
} from '../../shared/claude-terminal-account-switch'
import type { ClaudeTerminalSwitchCapture } from '../claude-accounts/atomic-terminal-account-switch'
import { runAtomicClaudeTerminalAccountSwitch } from '../claude-accounts/atomic-terminal-account-switch'
import {
  buildClaudeTerminalAccountSwitchPorts,
  resolveClaudeTerminalSwitchShell,
  resolvePtyClaudeAccountId,
  type ClaudeTerminalAccountSwitchServices
} from './claude-terminal-account-switch-ports'
import type { OrcaRuntimeService } from './orca-runtime'

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
}> {
  const attached = services
  if (!attached) {
    throw new ClaudeTerminalAccountSwitchRefusal('runtime-unavailable')
  }
  const snapshot = await runtime.snapshotClaudeTerminalSwitchTarget(request.target)
  if (!snapshot.ok) {
    throw new ClaudeTerminalAccountSwitchRefusal('terminal-not-found')
  }
  if (snapshot.isWsl || snapshot.remoteConnectionId) {
    throw new ClaudeTerminalAccountSwitchRefusal('unsupported-runtime')
  }
  if (!snapshot.cwd) {
    throw new ClaudeTerminalAccountSwitchRefusal('terminal-not-found')
  }
  const sourceAccountId = resolvePtyClaudeAccountId(attached, snapshot.ptyId)
  if (!sourceAccountId) {
    throw new ClaudeTerminalAccountSwitchRefusal('source-unknown')
  }
  if (!snapshot.providerSession) {
    throw new ClaudeTerminalAccountSwitchRefusal('missing-session')
  }
  if (!snapshot.launchConfig?.agentCommand?.trim()) {
    throw new ClaudeTerminalAccountSwitchRefusal('missing-launch-config')
  }

  const capture: ClaudeTerminalSwitchCapture = {
    operationId: `claude-switch-${++operationSeq}-${Date.now()}`,
    terminal: snapshot.terminal,
    ptyId: snapshot.ptyId,
    paneKey: snapshot.paneKey,
    sourceAccountId,
    targetAccountId: request.targetAccountId,
    runtime: 'host',
    wslDistro: null,
    cwd: snapshot.cwd,
    sessionId: snapshot.providerSession.id,
    launchConfig: snapshot.launchConfig,
    platform: process.platform,
    shell: resolveClaudeTerminalSwitchShell({
      isWsl: snapshot.isWsl,
      terminalWindowsShell: attached.getSettings().terminalWindowsShell
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
    sessionId: capture.sessionId
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

  const ports = buildClaudeTerminalAccountSwitchPorts(runtime, attached, capture, (state) => {
    record.result = { ...record.result, state }
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

  return { acceptance, settled: record.settled }
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

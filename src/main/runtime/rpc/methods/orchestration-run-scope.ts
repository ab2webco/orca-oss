import type { OrchestrationCompatibilityEvidence } from '../../../../shared/orchestration-compatibility-evidence'
import type { OrchestrationCompatibilityCallerAuthority } from '../../orca-runtime'
import { orchestrationSkillRecoveryData } from '../../../../shared/orchestration-rpc-contract'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import type { RunRow } from '../../orchestration/types'
import type { OrcaRuntimeService } from '../../orca-runtime'

export type RunScopeParams = {
  runId?: string
  callerTerminalHandle?: string
  callerPaneKey?: string
  requireCurrentConsumer: boolean
  legacyCoordinatorRunId?: string
  // Why: the caller's declared handle is a user param; this is the attested one to check it against.
  callerEvidence?: OrchestrationCompatibilityEvidence
}

// Why: declared handles select mutable Run bindings, so attested callers may only name themselves.
export function assertCallerHandleMatchesEvidence(
  runtime: OrcaRuntimeService,
  callerTerminalHandle: string,
  callerEvidence?: OrchestrationCompatibilityEvidence,
  callerAuthority?: OrchestrationCompatibilityCallerAuthority
): void {
  const attested = callerEvidence
    ? runtime.verifyOrchestrationCompatibilityCaller(callerEvidence)
    : null
  if (attested) {
    if (attested.terminalHandle !== callerTerminalHandle) {
      throw new OrchestrationError(
        'consumer_fenced',
        `This terminal is attested as ${attested.terminalHandle} and cannot act as ${callerTerminalHandle}.`,
        { effectsApplied: false }
      )
    }
    return
  }
  // Why: without this, omitting the evidence skipped the check entirely — `env -u
  // ORCA_AGENT_LAUNCH_TOKEN orca orchestration run-current --from <someone else>` returned ok.
  if (!runtime.orchestrationCallerRequiresAttestation(callerTerminalHandle)) {
    return
  }
  // Why: a freshly launched pane holds the real launch secret before the agent hook has observed
  // it, and that live-launch match already proves it may name itself. The dispatcher may have
  // established the same authority for this request already, so reuse it rather than re-deriving.
  const freshLaunch =
    callerAuthority ??
    (callerEvidence
      ? runtime.verifyOrchestrationCompatibilityCaller(callerEvidence, {
          currentRuntimeLaunchSufficient: true
        })
      : null)
  if (freshLaunch?.terminalHandle === callerTerminalHandle) {
    return
  }
  throw new OrchestrationError(
    'consumer_fenced',
    `Terminal ${callerTerminalHandle} is an attested agent pane, so this caller must present its launch evidence to act as it.`,
    { effectsApplied: false }
  )
}

// Why: task and gate mutations must share one Run-binding rule.
export function resolveRunScope(runtime: OrcaRuntimeService, params: RunScopeParams): RunRow {
  const db = runtime.getOrchestrationDb()
  const explicit = params.runId ? db.getRun(params.runId) : undefined
  if (params.runId && (!explicit || explicit.legacy === 1)) {
    throw new OrchestrationError('run_not_found', `Run ${params.runId} was not found.`)
  }

  if (!params.requireCurrentConsumer && explicit) {
    return explicit
  }
  if (!params.callerTerminalHandle) {
    throw new OrchestrationError(
      'run_required',
      'No Run is bound. Use orchestration run-create or run-use first. No effects were applied.',
      orchestrationSkillRecoveryData()
    )
  }
  assertCallerHandleMatchesEvidence(runtime, params.callerTerminalHandle, params.callerEvidence)
  if (explicit && params.legacyCoordinatorRunId === explicit.id) {
    return explicit
  }
  const paneKey = params.callerPaneKey ?? runtime.getTerminalPaneKey(params.callerTerminalHandle)
  if (!paneKey) {
    throw new OrchestrationError(
      'stable_pane_required',
      'The coordinator terminal has no stable pane identity.'
    )
  }
  const current = db.getCurrentRunForPane(paneKey)
  if (!current) {
    if (explicit) {
      throw new OrchestrationError(
        'consumer_fenced',
        `This coordinator terminal is no longer bound to Run ${explicit.id}.`
      )
    }
    throw new OrchestrationError(
      'run_required',
      'No Run is bound. Use orchestration run-create or run-use first. No effects were applied.',
      orchestrationSkillRecoveryData()
    )
  }
  if (explicit && current.id !== explicit.id) {
    throw new OrchestrationError(
      'consumer_fenced',
      `This coordinator terminal is bound to ${current.id}, not ${explicit.id}.`
    )
  }
  return current
}

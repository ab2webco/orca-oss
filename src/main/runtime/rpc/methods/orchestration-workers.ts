import type { TuiAgent } from '../../../../shared/types'
import { describeAgentStartupBlocked } from '../../claude-startup-dialog-signal'
import { DISPATCH_INPUT_WRITTEN_UNPROVEN } from '../../../../shared/dispatch-delivery-proof'
import { recordTurnAcceptanceInBackground } from '../../orchestration/dispatch-turn-acceptance'
import { AGENT_COMPOSER_READY_TIMEOUT_MS } from '../../agent-composer-readiness'
import { defineMethod, type RpcContext, type RpcMethod } from '../core'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { startFederatedWorker } from './orchestration-federated-worker-start'
import { workerDispatchInputOf } from './orchestration-worker-dispatch-input'
import { WorkerStartParams, type WorkerStartInput } from './orchestration-worker-start-schema'
import {
  createExistingWorktreeWorkerTerminal,
  createWorkerWorktree,
  monitorWorkerSetup,
  requireWorkerAuthority,
  type WorkerEffect,
  type WorkerSetupReceipt
} from './orchestration-worker-topology'
import {
  persistGatedSetupSpawnFailure,
  persistWorkerReadinessStage,
  persistWorkerSetupWaitOutcome
} from './orchestration-worker-setup-gate'
import { failWorkerStartWithReceipt } from './orchestration-worker-start-receipt'
import { waitForAgentTuiIdle } from './agent-readiness-timeout'
import {
  admitWorkerSetup,
  holdSlotForSetup,
  runQueuedStart,
  type WorkerSetupSlot
} from './orchestration-worker-setup-queue'
import {
  requireWorkerStartTask,
  resolveExistingWorkerWorktree,
  resolveLocalWorkerTopology
} from './orchestration-worker-start-context'

export const ORCHESTRATION_WORKER_START_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'orchestration.workerStart',
    params: WorkerStartParams,
    handler: (params, { runtime, orchestrationMutation }) =>
      startWorker(params, runtime, orchestrationMutation)
  })
]

async function startWorker(
  params: WorkerStartInput,
  runtime: OrcaRuntimeService,
  orchestrationMutation: RpcContext['orchestrationMutation'],
  admittedSlot?: WorkerSetupSlot
): Promise<unknown> {
  const { db, run, task } = requireWorkerStartTask(params, runtime)

  if (params.on) {
    return startFederatedWorker({
      params,
      runtime,
      db,
      runId: run.id,
      task,
      orchestrationMutation
    })
  }

  const topology = await resolveLocalWorkerTopology(params, runtime)
  const { requestedWorktree, createsWorktree, agent, launch, creationWorktree } = topology
  let resolvedWorktree = await resolveExistingWorkerWorktree(params, runtime, topology)

  const startOptions = {
    worktree: requestedWorktree,
    resolvedWorktreeId: resolvedWorktree?.id ?? null,
    name: params.name ?? null,
    repo: params.repo ?? creationWorktree?.repoId ?? null,
    baseBranch: params.baseBranch ?? null,
    terminal: params.terminal ?? null,
    agent: agent ?? null,
    claudeAccountId: params.claudeAccountId ?? null,
    codexAccountId: params.codexAccountId ?? null,
    launch: launch.receipt,
    timeoutMs: params.timeoutMs ?? 60_000,
    setup: createsWorktree ? (params.setup ?? 'run') : 'not_applicable',
    setupSource: createsWorktree
      ? params.setup
        ? 'explicit_request'
        : 'orchestration_default'
      : 'existing_worktree'
  }
  let setupSlot = admittedSlot
  if (creationWorktree && params.setupAdmission === 'queue' && !setupSlot) {
    const label = params.displayName ?? params.name ?? task.id
    const admission = await admitWorkerSetup({
      runtime,
      repoSelector: startOptions.repo ?? creationWorktree.repoId,
      taskId: task.id,
      label,
      start: (slot) =>
        runQueuedStart({
          runtime,
          runId: run.id,
          taskId: task.id,
          label,
          slot,
          start: () => startWorker(params, runtime, undefined, slot)
        })
    })
    if ('queued' in admission) {
      // Why: the mutation executor completes this request's receipt, which a Dispatch would open.
      if (orchestrationMutation) {
        db.beginMutationReceipt(orchestrationMutation)
      }
      // Why no Dispatch yet: the Task stays ready, so a restart leaves it for resume-members.
      return { runId: run.id, taskId: task.id, state: 'queued', setupQueue: admission.queued }
    }
    setupSlot = admission.slot
  }
  let started
  try {
    started = db.createStartingWorkerDispatch({
      taskId: task.id,
      retryOf: params.retryOf,
      startOptions,
      runtimeEpoch: runtime.getRuntimeId(),
      mutationReceipt: orchestrationMutation
    })
  } catch (error) {
    setupSlot?.release()
    throw error
  }
  const effects: WorkerEffect[] = []
  if (resolvedWorktree) {
    effects.push(
      { kind: 'worktree', action: 'reused', id: resolvedWorktree.id },
      { kind: 'setup', action: 'not_applicable', state: 'not_applicable' }
    )
  }
  let terminalHandle = params.terminal
  let terminalRevealWarning: string | undefined
  let failedStage = 'terminal_create'
  let setupReceipt: WorkerSetupReceipt = {
    requested: 'not_applicable',
    effective: 'not_applicable',
    source: 'existing_worktree',
    hookFound: false,
    startupPolicy: 'start-immediately',
    state: 'not_applicable'
  }
  try {
    if (creationWorktree) {
      failedStage = 'worktree_create'
      const created = await createWorkerWorktree({
        runtime,
        db,
        dispatchId: started.dispatch.id,
        requestedWorktree,
        coordinatorWorktree: creationWorktree,
        params,
        agent: agent as TuiAgent,
        launchPreferences: launch.preferences,
        effects
      })
      resolvedWorktree = created.worktree
      terminalHandle = created.terminalHandle
      setupReceipt = created.setupReceipt
      if (setupSlot) {
        holdSlotForSetup(runtime, setupSlot, setupReceipt, effects)
      }
    } else if (!terminalHandle) {
      db.recordWorkerStage({
        dispatchId: started.dispatch.id,
        stage: 'terminal_creating',
        worktreeId: resolvedWorktree!.id,
        effects
      })
      const terminal = await createExistingWorktreeWorkerTerminal({
        runtime,
        worktreeId: resolvedWorktree!.id,
        agent: agent as TuiAgent,
        launchPreferences: launch.preferences,
        taskId: task.id,
        claudeAccountId: params.claudeAccountId,
        codexAccountId: params.codexAccountId,
        ...(params.game ? { gameMember: true } : {}),
        effects
      })
      terminalHandle = terminal.handle
      terminalRevealWarning = terminal.warning
    } else {
      effects.push({
        kind: 'terminal',
        role: 'agent',
        action: 'reused',
        id: terminalHandle
      })
    }
    if (!resolvedWorktree || !terminalHandle) {
      throw new Error('Worker topology did not resolve an agent terminal and worktree.')
    }
    const setupStage = {
      db,
      dispatchId: started.dispatch.id,
      worktreeId: resolvedWorktree.id,
      terminalHandle,
      setup: setupReceipt,
      effects
    }
    if (persistGatedSetupSpawnFailure(setupStage)) {
      failedStage = 'setup_start'
      throw new Error('Setup terminal failed to start before the gated agent launch.')
    }
    persistWorkerReadinessStage(setupStage)

    failedStage = 'agent_readiness'
    // Why (ORCA-191): readiness has two stages now, and both must fit the
    // one budget the caller asked for — the CLI's transport timeout is
    // sized from it, so spending a separate budget on the second stage
    // would time the caller out on a start the runtime still completes.
    const readinessBudgetMs = params.timeoutMs ?? 60_000
    const readinessDeadline = Date.now() + readinessBudgetMs
    const wait = await waitForAgentTuiIdle(runtime, terminalHandle, agent, readinessBudgetMs)
    persistWorkerSetupWaitOutcome({ ...setupStage, wait })
    // Why: a wait-for-setup agent saw the setup end; its Setup tab may never exit.
    if (setupReceipt.state !== 'running') {
      setupSlot?.release()
    }
    if (!wait.satisfied) {
      if (setupReceipt.state === 'failed') {
        failedStage = 'setup_wait'
      }
      throw new Error(
        wait.blockedReason
          ? describeAgentStartupBlocked(wait.blockedReason)
          : `Agent did not become ready (${wait.status}).`
      )
    }
    // Why (ORCA-191): this is the path the incident ran through. `tui-idle`
    // is satisfied for Codex before the composer accepts input, so the
    // preamble lands in a redraw and the run sits `dispatched` forever.
    // Hold the write until the agent's own marker says the composer
    // mounted. This never fails the start: a missing marker is not evidence
    // of unreadiness, so expiry proceeds and records `proven` instead.
    //
    // Why min(): expiry is benign, so spending the caller's whole remaining
    // budget on a wait that is already failing is pure latency — and it is
    // latency paid by exactly the panes that will never mark ready.
    const composerReady = await runtime.waitForAgentComposerReady(terminalHandle, {
      timeoutMs: Math.max(
        0,
        Math.min(AGENT_COMPOSER_READY_TIMEOUT_MS, readinessDeadline - Date.now())
      )
    })
    const terminalAuthority = requireWorkerAuthority(runtime, terminalHandle)
    const capability = db.prepareStartingWorkerAuthority({
      dispatchId: started.dispatch.id,
      handle: terminalHandle,
      ...terminalAuthority,
      worktreeId: resolvedWorktree.id,
      effects,
      setupState: setupReceipt.state,
      terminalOwnership: params.terminal ? 'external' : 'created'
    })

    failedStage = 'dispatch_input'
    const input = await workerDispatchInputOf({
      runtime,
      params,
      task,
      dispatchId: started.dispatch.id,
      terminalHandle,
      capability,
      worktreeId: resolvedWorktree.id
    })
    const sent = await runtime.sendTerminalAgentPromptObservingTurn(terminalHandle, input)
    effects.push({
      kind: 'dispatch_input',
      role: 'agent',
      id: terminalHandle,
      // Why: `accepted` claims the agent took the preamble. Without the
      // marker nothing in the byte stream supports that claim, so the
      // effect says what actually happened — bytes written, delivery
      // unproven — instead of overstating it.
      state: composerReady.proven ? 'accepted' : DISPATCH_INPUT_WRITTEN_UNPROVEN
    })
    const worker = db.markWorkerDispatchReady(started.dispatch.id, effects)
    // Why: after markWorkerDispatchReady, not before — the update is scoped
    // to `status = 'dispatched'`, which this call is what establishes.
    db.recordDispatchComposerReadiness(started.dispatch.id, composerReady.proven)
    runtime.ensureOrchestrationDispatchDeadlineMonitor()
    // Why (ORCA-191): not awaited. Turn acceptance never refuses, and its
    // Enter retry (ORCA-754) runs after the write, so it must not spend the
    // caller's budget. It lands on the dispatch row for `dispatch show` and
    // the deadline's failure reason.
    void recordTurnAcceptanceInBackground(db, started.dispatch.id, sent.turnAcceptance, sent.submit)
    monitorWorkerSetup({
      runtime,
      db,
      runId: run.id,
      dispatchId: started.dispatch.id,
      setupReceipt,
      effects
    })
    return {
      runId: run.id,
      taskId: task.id,
      dispatchId: started.dispatch.id,
      state: worker.state,
      stage: worker.stage,
      setup: setupReceipt,
      launch: launch.receipt,
      timeoutMs: params.timeoutMs ?? 60_000,
      effects,
      residualResources: [],
      ...(terminalRevealWarning ? { warning: terminalRevealWarning } : {})
    }
  } catch (error) {
    if (setupSlot && !setupSlot.watching) {
      setupSlot.release()
    }
    return failWorkerStartWithReceipt({
      db,
      runId: run.id,
      taskId: task.id,
      dispatchId: started.dispatch.id,
      failedStage,
      error,
      setup: setupReceipt,
      launch: launch.receipt
    })
  }
}

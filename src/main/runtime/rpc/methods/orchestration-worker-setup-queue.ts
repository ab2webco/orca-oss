import type { OrcaRuntimeService } from '../../orca-runtime'
import type { OrchestrationDb } from '../../orchestration/db'
import { LOCAL_SETUP_HOST } from '../../orchestration/worker-setup-admission'
import type { WorkerEffect, WorkerSetupReceipt } from './orchestration-worker-topology'

/** The host's one setup slot, held by a start whose new worktree runs setup (ORCA-746). */
export type WorkerSetupSlot = { release: () => void; watching: boolean }

export type WorkerSetupQueued = { position: number; waitingOn: string }

const slotOf = (release: () => void): WorkerSetupSlot => ({ release, watching: false })

export async function admitWorkerSetup(args: {
  runtime: OrcaRuntimeService
  repoSelector: string
  taskId: string
  label: string
  /** Runs the start once the slot frees; it owns the slot from then on. */
  start: (slot: WorkerSetupSlot) => Promise<void>
}): Promise<{ slot: WorkerSetupSlot } | { queued: WorkerSetupQueued }> {
  const repo = await args.runtime.showRepo(args.repoSelector)
  // Why per connection: an SSH setup spends the remote host's memory, not this machine's.
  const host = repo.connectionId ? `ssh:${repo.connectionId}` : LOCAL_SETUP_HOST
  const admission = await args.runtime.getWorkerSetupAdmission().admit({
    host,
    taskId: args.taskId,
    label: args.label,
    start: (release) => args.start(slotOf(release))
  })
  return admission.admitted
    ? { slot: slotOf(admission.release) }
    : { queued: { position: admission.position, waitingOn: admission.waitingOn } }
}

/** Holds the slot until the new worktree's setup command ends; frees it at once when none runs. */
export function holdSlotForSetup(
  runtime: OrcaRuntimeService,
  slot: WorkerSetupSlot,
  setup: WorkerSetupReceipt,
  effects: readonly WorkerEffect[]
): void {
  const terminal = effects.find((effect) => effect.kind === 'setup')?.terminalId
  if (setup.state !== 'running' || !terminal) {
    slot.release()
    return
  }
  slot.watching = true
  void runtime.waitForSetupTerminalCompletion(terminal).then(slot.release, slot.release)
}

/** A start that waited for the slot; nobody awaits it, so a failure is mailed to the lead. */
export async function runQueuedStart(args: {
  runtime: OrcaRuntimeService
  runId: string
  taskId: string
  label: string
  slot: WorkerSetupSlot
  start: () => Promise<unknown>
}): Promise<void> {
  const fail = (reason: string): void =>
    postQueuedStartFailure({ ...args, db: args.runtime.getOrchestrationDb(), reason })
  try {
    const result = (await args.start()) as { state?: string; lastError?: string }
    if (result.state === 'failed' || result.state === 'outcome_unknown') {
      fail(result.lastError ?? result.state)
    }
  } catch (error) {
    if (!args.slot.watching) {
      args.slot.release()
    }
    fail(error instanceof Error ? error.message : String(error))
  }
}

function postQueuedStartFailure(args: {
  runtime: OrcaRuntimeService
  db: OrchestrationDb
  runId: string
  taskId: string
  label: string
  reason: string
}): void {
  const message = args.db.insertMessage({
    runId: args.runId,
    from: `task:${args.taskId}`,
    to: `run:${args.runId}`,
    subject: `Queued start of ${args.label} failed: ${args.reason}`,
    type: 'status',
    priority: 'high',
    payload: JSON.stringify({ taskId: args.taskId, reason: args.reason })
  })
  args.runtime.notifyMessageArrived(message.to_handle, message.type)
}

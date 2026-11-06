import type { RuntimeStatus } from '../../../../shared/runtime-types'
import { ORCHESTRATION_FEDERATION_RELEASE_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { FederatedDispatchRow } from '../../orchestration/types'
import { WORKER_SETTLED_STATES } from '../../orchestration/worker-terminal-ownership'
import { assertFederationReleaseReceipt } from './orchestration-federation-release'
import {
  isFederatedMemberGoneOnHost,
  isHostDispatchNotFound
} from './orchestration-federated-worker-gone'
import type { WorkerReleaseReceipt } from './orchestration-worker-release-completion'
import { retainedRecoveryOf } from './orchestration-worker-retained-recovery'
import { resolvePinnedFederatedServer } from './orchestration-worker-observation'

type FederatedWorkerReleaseReceipt = WorkerReleaseReceipt & {
  remote?: {
    closedTerminals: string[]
    removedWorktree: string | null
    worktreeError?: string
    /** The host had nothing of it left; the home settles the ghost row. */
    alreadyGone?: true
  }
  /** The other dispatches of its host worktree released with it (ORCA-1076). */
  worktreeDispatches?: Pick<WorkerReleaseReceipt, 'dispatchId' | 'state' | 'reason'>[]
}

type FederatedReleaseArgs = {
  runtime: OrcaRuntimeService
  federated: FederatedDispatchRow
  requestId: string | undefined
}

const LIVE_STATES: readonly string[] = ['starting', 'ready', 'start_unknown']

const isReleased = (receipt: WorkerReleaseReceipt): boolean =>
  receipt.state === 'released' || receipt.state === 'already_released'

/**
 * Releases a settled remote member on its host, with every other dispatch in its host worktree:
 * a follow-up reuses the terminal and worktree, so only the dispatch that created them removes them.
 */
export async function releaseFederatedWorker(
  args: FederatedReleaseArgs
): Promise<FederatedWorkerReleaseReceipt> {
  const db = args.runtime.getOrchestrationDb()
  const dispatchId = args.federated.dispatch_id
  const siblings = db.listUnreleasedWorktreeSiblings(dispatchId)
  const running = siblings.find((sibling) => LIVE_STATES.includes(sibling.state ?? ''))
  if (running) {
    const base = { dispatchId, processAction: 'none' as const, archive: null }
    if (db.getWorkerDispatch(dispatchId)?.stage === 'released') {
      return { ...base, state: 'already_released' }
    }
    // Why: its terminal and worktree belong to a member still at work there.
    return {
      ...base,
      state: 'retained',
      reason: 'not_settled',
      recovery: `Dispatch ${running.dispatchId} still runs in its worktree on ${args.federated.environment_name}; stop or release that one first.`
    }
  }
  const own = await releaseOneFederatedWorker(args)
  if (siblings.length === 0 || !isReleased(own)) {
    return own
  }
  const others: FederatedWorkerReleaseReceipt[] = []
  for (const sibling of siblings) {
    const federated = db.getFederatedDispatch(sibling.dispatchId)
    if (federated) {
      others.push(
        await releaseOneFederatedWorker({
          ...args,
          federated,
          // Why derived: the host refuses one request id reused for another dispatch.
          requestId: args.requestId ? `${args.requestId}:${sibling.dispatchId}` : undefined
        })
      )
    }
  }
  return memberReceiptOf(own, others)
}

/** One receipt for the member: what every dispatch in its worktree closed and removed. */
function memberReceiptOf(
  own: FederatedWorkerReleaseReceipt,
  others: FederatedWorkerReleaseReceipt[]
): FederatedWorkerReleaseReceipt {
  const all = [own, ...others]
  const kept = others.find((other) => !isReleased(other))
  const remotes = all.flatMap((receipt) => (receipt.remote ? [receipt.remote] : []))
  const worktreeError = remotes.find((remote) => remote.worktreeError)?.worktreeError
  const outcome = kept
    ? { state: kept.state, reason: kept.reason, recovery: kept.recovery }
    : own.state === 'already_released' && others.some((other) => other.state === 'released')
      ? { state: 'released' as const }
      : {}
  return {
    ...own,
    ...outcome,
    processAction: all.some((receipt) => receipt.processAction === 'closed_agent_terminal')
      ? 'closed_agent_terminal'
      : own.processAction,
    remote: {
      ...own.remote,
      closedTerminals: remotes.flatMap((remote) => remote.closedTerminals),
      removedWorktree: remotes.find((remote) => remote.removedWorktree)?.removedWorktree ?? null,
      ...(worktreeError ? { worktreeError } : {})
    },
    worktreeDispatches: others.map((other) => ({
      dispatchId: other.dispatchId,
      state: other.state,
      ...(other.reason ? { reason: other.reason } : {})
    }))
  }
}

async function releaseOneFederatedWorker(
  args: FederatedReleaseArgs
): Promise<FederatedWorkerReleaseReceipt> {
  const { runtime, federated } = args
  const dispatchId = federated.dispatch_id
  const db = runtime.getOrchestrationDb()
  const worker = db.getWorkerDispatch(dispatchId)
  const base = { dispatchId, processAction: 'none' as const, archive: null }
  if (worker?.stage === 'released') {
    return { ...base, state: 'already_released' }
  }
  const settleGone = (): FederatedWorkerReleaseReceipt => {
    db.markFederatedWorkerReleased(dispatchId)
    runtime.notifyMessageArrived(`dispatch:${dispatchId}`, 'status')
    const remote = { closedTerminals: [], removedWorktree: null, alreadyGone: true as const }
    return { ...base, state: 'released', remote }
  }
  if (!worker || !WORKER_SETTLED_STATES.includes(worker.state)) {
    const stopping = worker?.state === 'stopping' || worker?.state === 'stop_unknown'
    if (!stopping) {
      return {
        ...base,
        state: 'retained',
        reason: 'not_settled',
        recovery: retainedRecoveryOf('not_settled', dispatchId, null)
      }
    }
    // Why: a stop the host could not prove stays stop_unknown, and only the host can show nothing is left (ORCA-864).
    const server = resolvePinnedFederatedServer(runtime, federated)
    if (
      await isFederatedMemberGoneOnHost(runtime, server.environmentId, dispatchId).catch(
        () => false
      )
    ) {
      db.reconcileFederatedWorkerStop(dispatchId)
      return settleGone()
    }
    return {
      ...base,
      state: 'retained',
      reason: 'not_settled',
      recovery: `Its stop on ${server.name} was not proven: its terminal or worktree is still there, or ${server.name} did not answer. Close its terminal on ${server.name}, then release again.`
    }
  }
  const server = resolvePinnedFederatedServer(runtime, federated)
  const status = (await runtime.callOrchestrationWorkerServer(
    server.environmentId,
    'status.get',
    undefined,
    15_000
  )) as RuntimeStatus
  if (!status.capabilities?.includes(ORCHESTRATION_FEDERATION_RELEASE_RUNTIME_CAPABILITY)) {
    if (await isFederatedMemberGoneOnHost(runtime, server.environmentId, dispatchId)) {
      return settleGone()
    }
    return {
      ...base,
      state: 'retained',
      reason: 'federation_unsupported',
      recovery: `${server.name} cannot release remote workers yet; update Orca on ${server.name}, or remove its worktree there directly.`
    }
  }
  let remote
  try {
    remote = assertFederationReleaseReceipt(
      await runtime.callOrchestrationWorkerServer(
        server.environmentId,
        'orchestration.federationRelease',
        { dispatchId },
        30_000,
        args.requestId ? { orchestrationRequestId: args.requestId } : undefined
      )
    )
  } catch (error) {
    if (isHostDispatchNotFound(error)) {
      return settleGone()
    }
    throw error
  }
  const detail = {
    closedTerminals: remote.closedTerminals,
    removedWorktree: remote.removedWorktree,
    ...(remote.worktreeError ? { worktreeError: remote.worktreeError } : {})
  }
  if (remote.state === 'retained') {
    return {
      ...base,
      state: 'retained',
      reason: remote.reason,
      remote: detail,
      ...(remote.reason
        ? { recovery: `${server.name}: ${retainedRecoveryOf(remote.reason, dispatchId, null)}` }
        : {})
    }
  }
  db.markFederatedWorkerReleased(dispatchId)
  runtime.notifyMessageArrived(`dispatch:${dispatchId}`, 'status')
  return {
    ...base,
    state: remote.state,
    processAction: remote.closedTerminals.length > 0 ? 'closed_agent_terminal' : 'none',
    remote: detail
  }
}

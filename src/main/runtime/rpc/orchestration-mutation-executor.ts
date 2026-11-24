import { createHash } from 'node:crypto'
import { isOrchestrationMutation } from '../../../shared/orchestration-rpc-contract'
import { parsePaneKey } from '../../../shared/stable-pane-id'
import type { OrcaRuntimeService } from '../orca-runtime'
import { OrchestrationError } from '../orchestration/orchestration-error'
import type { RpcRequest } from './core'

export type DurableMutationInvocation = {
  identity: {
    callerFingerprint: string
    requestId: string
    method: string
    payloadHash: string
  }
  recordReceipt: (receipt: unknown) => void
}

export class OrchestrationMutationExecutor {
  private readonly inFlight = new Map<string, Promise<unknown>>()
  // Why: a start awaits before run() marks it in flight; a probe in that gap must not read not_applied.
  private readonly receivedStarts = new Map<string, number>()

  constructor(private readonly runtime: OrcaRuntimeService) {}

  async run(
    request: RpcRequest,
    params: unknown,
    invoke: (mutation?: DurableMutationInvocation) => unknown,
    callerFingerprintOverride?: string
  ): Promise<unknown> {
    const requestId = request.orchestrationRequestId
    if (!requestId || !isOrchestrationMutation(request.method, params)) {
      return await invoke()
    }
    const callerFingerprint =
      callerFingerprintOverride ?? this.getLocalAuthenticatedCallerFingerprint()
    const payloadHash = createHash('sha256')
      .update(
        JSON.stringify(
          canonicalize({
            method: request.method,
            params: replayStableCallerParams(this.runtime, params)
          })
        )
      )
      .digest('hex')
    const key = `${callerFingerprint}:${requestId}`
    const db = this.runtime.getOrchestrationDb()
    const identity = { callerFingerprint, requestId, method: request.method, payloadHash }
    const atomicWorkerAcceptance =
      request.method === 'orchestration.workerStart' ||
      request.method === 'orchestration.federationAttachStart'
    const begun = atomicWorkerAcceptance
      ? (() => {
          const row = db.getMutationReceipt(callerFingerprint, requestId)
          if (!row) {
            return { disposition: 'started' as const }
          }
          if (row.method !== request.method || row.payload_hash !== payloadHash) {
            throw new OrchestrationError(
              'request_mismatch',
              `Mutation request ${requestId} was already used with different input.`
            )
          }
          return { disposition: row.state, row }
        })()
      : db.beginMutationReceipt(identity)
    const resumedPendingMutation =
      begun.disposition === 'pending' && request.method === 'orchestration.workerRelease'

    if (begun.disposition === 'completed') {
      const active = this.inFlight.get(key)
      if (active) {
        return attachMutationReceipt(await active, requestId, true)
      }
      return attachMutationReceipt(JSON.parse(begun.row.receipt ?? 'null'), requestId, true)
    }
    if (begun.disposition === 'pending') {
      const active = this.inFlight.get(key)
      if (active) {
        return attachMutationReceipt(await active, requestId, true)
      }
      if (request.method !== 'orchestration.workerRelease') {
        const recovery = getPendingWorkerStartRecovery(request.method, begun.row.receipt)
        throw new OrchestrationError(
          'operation_unknown',
          recovery
            ? `Worker start ${requestId} was accepted as Dispatch ${recovery.dispatchId} before restart. Inspect that Dispatch; do not start another worker.`
            : `Mutation ${requestId} may have been accepted before restart. Retry inspection or recovery with the same request ID.`,
          recovery
            ? {
                requestId,
                dispatchId: recovery.dispatchId,
                recoveryCommand: `orca orchestration worker-show --dispatch ${recovery.dispatchId} --json`
              }
            : { requestId }
        )
      }
    }

    const recordReceipt = (result: unknown): void => {
      db.completeMutationReceipt({
        ...identity,
        receipt: JSON.stringify(attachMutationReceipt(result, requestId, resumedPendingMutation))
      })
    }
    const active = Promise.resolve().then(() => invoke({ identity, recordReceipt }))
    this.inFlight.set(key, active)
    try {
      const result = await active
      const receipted = attachMutationReceipt(result, requestId, resumedPendingMutation)
      db.completeMutationReceipt({ ...identity, receipt: JSON.stringify(receipted) })
      return receipted
    } catch (error) {
      if (!(error instanceof OrchestrationError && error.code === 'operation_unknown')) {
        db.discardPendingMutationReceipt(callerFingerprint, requestId)
      }
      throw error
    } finally {
      this.inFlight.delete(key)
    }
  }

  /** Holds a worker start's request id from dispatcher entry until its reply; returns the release. */
  noteReceived(request: RpcRequest): () => void {
    const id = request.orchestrationRequestId
    if (!id || request.method !== 'orchestration.workerStart') {
      return () => undefined
    }
    this.receivedStarts.set(id, (this.receivedStarts.get(id) ?? 0) + 1)
    return () => {
      const left = (this.receivedStarts.get(id) ?? 1) - 1
      if (left > 0) {
        this.receivedStarts.set(id, left)
      } else {
        this.receivedStarts.delete(id)
      }
    }
  }

  /** Whether a worker start under this request id was accepted, read without running it (ORCA-1398). */
  workerStartOutcomeOf(callerFingerprint: string, requestId: string): WorkerStartOutcome {
    const row = this.runtime.getOrchestrationDb().getMutationReceipt(callerFingerprint, requestId)
    const dispatchId =
      row?.method === 'orchestration.workerStart' ? acceptedDispatchIdOf(row.receipt) : undefined
    if (dispatchId) {
      return { applied: 'applied', dispatchId }
    }
    // Why in-flight is unknown: its acceptance may still commit after this read.
    if (
      this.receivedStarts.has(requestId) ||
      this.inFlight.has(`${callerFingerprint}:${requestId}`)
    ) {
      return { applied: 'unknown', reason: 'in_flight' }
    }
    // Why a receipt without a Dispatch is unknown: a start queued for setup took effect without one.
    return row ? { applied: 'unknown', reason: 'no_dispatch' } : { applied: 'not_applied' }
  }

  getLocalAuthenticatedCallerFingerprint(): string {
    return this.runtime.getOrchestrationDb().getOrCreateLocalMutationCallerFingerprint()
  }
}

const executorsByRuntime = new WeakMap<OrcaRuntimeService, OrchestrationMutationExecutor>()

export function getOrchestrationMutationExecutor(
  runtime: OrcaRuntimeService
): OrchestrationMutationExecutor {
  const existing = executorsByRuntime.get(runtime)
  if (existing) {
    return existing
  }
  const executor = new OrchestrationMutationExecutor(runtime)
  executorsByRuntime.set(runtime, executor)
  return executor
}

export function fingerprintAuthenticatedPairingCredential(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function replayStableCallerParams(runtime: OrcaRuntimeService, params: unknown): unknown {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return params
  }
  const source = params as Record<string, unknown>
  const result = { ...source }
  // Why: the home's cached usage readings move between retries of the same attach (ORCA-1028).
  delete result.accountReadings
  for (const property of ['from', 'callerTerminalHandle'] as const) {
    const handle = source[property]
    if (typeof handle !== 'string') {
      continue
    }
    const paneKey =
      property === 'from' && typeof source.senderPaneKey === 'string'
        ? source.senderPaneKey
        : runtime.getTerminalPaneKey(handle)
    if (paneKey) {
      const leafId = parsePaneKey(paneKey)?.leafId
      result[property] = leafId ? { paneLeafId: leafId } : { paneKey }
    }
  }
  return result
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  const source = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(source).sort()) {
    if (source[key] !== undefined) {
      result[key] = canonicalize(source[key])
    }
  }
  return result
}

function attachMutationReceipt(result: unknown, requestId: string, replayed: boolean): unknown {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return { result, mutation: { requestId, replayed } }
  }
  return { ...(result as Record<string, unknown>), mutation: { requestId, replayed } }
}

export type WorkerStartOutcome =
  | { applied: 'applied'; dispatchId: string }
  | { applied: 'not_applied' }
  | { applied: 'unknown'; reason: 'in_flight' | 'no_dispatch' }

// Why both shapes: a pending receipt holds `accepted`, a completed one the start's own result.
function acceptedDispatchIdOf(receipt: string | null): string | undefined {
  try {
    const parsed = JSON.parse(receipt ?? 'null') as {
      dispatchId?: unknown
      accepted?: { dispatchId?: unknown }
    } | null
    const id = parsed?.dispatchId ?? parsed?.accepted?.dispatchId
    return typeof id === 'string' ? id : undefined
  } catch {
    return undefined
  }
}

function getPendingWorkerStartRecovery(
  method: string,
  receipt: string | null
): { dispatchId: string } | undefined {
  if (method !== 'orchestration.workerStart' || !receipt) {
    return undefined
  }
  try {
    const parsed = JSON.parse(receipt) as { accepted?: { dispatchId?: unknown } }
    return typeof parsed.accepted?.dispatchId === 'string'
      ? { dispatchId: parsed.accepted.dispatchId }
      : undefined
  } catch {
    return undefined
  }
}

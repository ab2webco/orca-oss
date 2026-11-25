import type { OrcaRuntimeService } from '../orca-runtime'
import type { OrchestrationDb } from './db'
import { encodeFederatedControlMessage } from './federation-control-message'
import { OrchestrationError } from './orchestration-error'
import type { FederationRelayItemRow } from './types'

// Why in memory: the relay retries every second, so a restarted home records the reason again at once.
const refusalsByRuntime = new WeakMap<OrcaRuntimeService, Map<string, string>>()

/** Why the member's host last refused its queued lead mail; absent once it takes it (ORCA-1439). */
export function federationImportRefusalOf(
  runtime: OrcaRuntimeService,
  dispatchId: string
): string | undefined {
  return refusalsByRuntime.get(runtime)?.get(dispatchId)
}

function clearFederationImportRefusal(runtime: OrcaRuntimeService, dispatchId: string): void {
  refusalsByRuntime.get(runtime)?.delete(dispatchId)
}

/** Hands the queued lead mail to the member's host, recording why when the host does not take it. */
export async function importWorkerRelay(
  runtime: OrcaRuntimeService,
  db: OrchestrationDb,
  environmentId: string,
  dispatchId: string,
  items: readonly FederationRelayItemRow[]
): Promise<void> {
  let delivered: { acknowledgedThrough: number }
  try {
    delivered = (await runtime.callOrchestrationWorkerServer(
      environmentId,
      'orchestration.federationImport',
      { dispatchId, items },
      15_000,
      { orchestrationRequestId: `relay_import_${dispatchId}_${items.at(-1)?.sequence ?? 0}` }
    )) as { acknowledgedThrough: number }
  } catch (error) {
    noteFederationImportRefusal(runtime, db, dispatchId, items, error)
    throw error
  }
  clearFederationImportRefusal(runtime, dispatchId)
  db.acknowledgeFederationRelay({
    dispatchId,
    direction: 'to_worker',
    throughSequence: delivered.acknowledgedThrough
  })
}

function noteFederationImportRefusal(
  runtime: OrcaRuntimeService,
  db: OrchestrationDb,
  dispatchId: string,
  items: readonly Pick<FederationRelayItemRow, 'sequence' | 'kind' | 'payload'>[],
  error: unknown
): void {
  const message = error instanceof Error ? error.message : String(error)
  const code = error instanceof OrchestrationError ? error.code : undefined
  let refusals = refusalsByRuntime.get(runtime)
  if (!refusals) {
    refusals = new Map()
    refusalsByRuntime.set(runtime, refusals)
  }
  refusals.set(dispatchId, code ? `${code}: ${message}` : message)
  if (code === 'question_not_found') {
    rewriteUnmatchedReply(db, dispatchId, items, message)
  }
}

// Why (ORCA-1439): a member that asked with `send --type question` instead of `ask` has no
// question on its host, so the host refuses the reply and every relay queued behind it forever.
// As control mail the answer reaches the member's inbox on any host version.
function rewriteUnmatchedReply(
  db: OrchestrationDb,
  dispatchId: string,
  items: readonly Pick<FederationRelayItemRow, 'sequence' | 'kind' | 'payload'>[],
  hostMessage: string
): void {
  for (const item of items) {
    const reply = item.kind === 'reply' ? replyOf(item.payload) : null
    if (!reply || !hostMessage.includes(reply.questionId)) {
      continue
    }
    const answer = db.getMessageById(reply.answerMessageId)
    db.rewritePendingWorkerRelayItem({
      dispatchId,
      sequence: item.sequence,
      kind: 'control_message',
      payload: encodeFederatedControlMessage({
        from: answer?.from_handle ?? `dispatch:${dispatchId}`,
        subject: answer?.subject ?? 'Re: Question',
        body: reply.body,
        type: 'status',
        priority: 'normal',
        threadId: reply.questionId,
        payload: null
      })
    })
    return
  }
}

function replyOf(
  payload: string
): { questionId: string; answerMessageId: string; body: string } | null {
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown> | null
    return parsed &&
      typeof parsed.questionId === 'string' &&
      typeof parsed.answerMessageId === 'string' &&
      typeof parsed.body === 'string'
      ? {
          questionId: parsed.questionId,
          answerMessageId: parsed.answerMessageId,
          body: parsed.body
        }
      : null
  } catch {
    return null
  }
}

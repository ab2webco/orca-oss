import { ORCHESTRATION_FEDERATION_CONTROL_MAIL_PROTOCOL_VERSION } from '../../../../shared/protocol-version'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { OrchestrationDb } from '../../orchestration/db'
import { routeFederatedMail } from '../../orchestration/federated-follow-up'
import { encodeFederatedControlMessage } from '../../orchestration/federation-control-message'
import { federationImportRefusalOf } from '../../orchestration/federation-import-refusal'
import { waitForRelayDelivery } from '../../orchestration/federation-relay-delivery'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import type { FederatedDispatchRow, MessagePriority, MessageType } from '../../orchestration/types'

export type FederatedControlMail = {
  from: string
  subject: string
  body: string
  type: MessageType
  priority: MessagePriority
  threadId: string | null
  payload: string | null
}

// Lead-to-member mail for a member on a paired host: queued on the durable relay, never at home.
export async function relayFederatedControlMail(
  runtime: OrcaRuntimeService,
  db: OrchestrationDb,
  target: FederatedDispatchRow,
  mail: FederatedControlMail,
  options: { runId?: string; beforeEnqueue?: () => void } = {}
) {
  const dispatchId = target.dispatch_id
  if (target.protocol_version < ORCHESTRATION_FEDERATION_CONTROL_MAIL_PROTOCOL_VERSION) {
    throw new OrchestrationError(
      'capability_unsupported',
      `Federated Dispatch ${dispatchId} does not support coordinator control mail; start a fresh worker after updating its Orca Lab server.`
    )
  }
  if (mail.type === 'worker_done' || mail.type === 'heartbeat') {
    throw new OrchestrationError(
      'invalid_argument',
      'Coordinator-to-worker control mail cannot report worker lifecycle.'
    )
  }
  const route = routeFederatedMail(db, target)
  const followUp = route.kind === 'control_message' ? undefined : route
  options.beforeEnqueue?.()
  const relay = db.enqueueFederationRelay({
    dispatchId,
    direction: 'to_worker',
    kind: route.kind,
    ...(followUp ? { reopenSettledReason: followUp.reopenSettledReason } : {}),
    payload: encodeFederatedControlMessage({
      ...mail,
      body: followUp ? `${mail.body}\n\n${followUp.note}` : mail.body
    })
  })
  runtime.ensureOrchestrationFederationRelay(options.runId)
  // Why: a queued send read as ok while the member never saw it (ORCA-1301).
  const deliveredAt = await waitForRelayDelivery(() =>
    db.getFederationRelayAckedAt(dispatchId, 'to_worker', relay.message_id)
  )
  const hostRefusal =
    deliveredAt === null ? federationImportRefusalOf(runtime, dispatchId) : undefined
  return {
    relay: {
      messageId: relay.message_id,
      sequence: relay.sequence,
      dispatchId: relay.dispatch_id,
      destination: 'worker' as const,
      accepted: true as const,
      delivered: deliveredAt !== null,
      deliveredAt,
      ...(hostRefusal ? { hostRefusal } : {})
    },
    ...(followUp ? { reopenedDispatchId: dispatchId } : {})
  }
}

export function federatedSenderOf(
  db: OrchestrationDb,
  handle: string
): FederatedDispatchRow | undefined {
  return handle.startsWith('dispatch:')
    ? db.getFederatedDispatch(handle.slice('dispatch:'.length))
    : undefined
}

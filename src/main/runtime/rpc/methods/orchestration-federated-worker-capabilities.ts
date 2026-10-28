import type { RuntimeStatus } from '../../../../shared/runtime-types'
import {
  ORCHESTRATION_CONTRACT_RUNTIME_CAPABILITY,
  ORCHESTRATION_FEDERATION_CONTROL_MAIL_PROTOCOL_VERSION,
  ORCHESTRATION_FEDERATION_CONTROL_MAIL_RUNTIME_CAPABILITY,
  ORCHESTRATION_FEDERATION_GAME_MEMBER_RUNTIME_CAPABILITY,
  ORCHESTRATION_FEDERATION_GAME_SCENE_RUNTIME_CAPABILITY,
  ORCHESTRATION_FEDERATION_LIFECYCLE_SETTLEMENT_PROTOCOL_VERSION,
  ORCHESTRATION_FEDERATION_LIFECYCLE_SETTLEMENT_RUNTIME_CAPABILITY,
  ORCHESTRATION_FEDERATION_RUNTIME_CAPABILITY
} from '../../../../shared/protocol-version'
import { orchestrationMigrationData } from '../../../../shared/orchestration-rpc-contract'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import type { WorkerStartInput } from './orchestration-worker-start-schema'
import { assertWorkerLaunchPreferencesRuntimeSupported } from './orchestration-worker-launch-preferences'

export type FederatedWorkerNegotiation = {
  federationProtocolVersion: 1 | 2 | 3
  /** Sent only to a host that confirmed it honors them. */
  gameMember: { game?: true; setupAdmission?: 'queue' }
  /** An older host drops the lead's scene, so it is read only for a host that keeps it. */
  carriesGameScene: boolean
}

/** Refuses, before any effect, a host that cannot run this start as asked. */
export function negotiateFederatedWorkerStart(args: {
  status: RuntimeStatus
  serverName: string
  params: WorkerStartInput
}): FederatedWorkerNegotiation {
  const { status, serverName, params } = args
  const capabilities = status.capabilities ?? []
  if (!capabilities.includes(ORCHESTRATION_CONTRACT_RUNTIME_CAPABILITY)) {
    throw new OrchestrationError(
      'orchestration_migration_required',
      `Connected server ${serverName} does not support the current orchestration contract. No effects were applied.`,
      orchestrationMigrationData('runtime_capability_missing')
    )
  }
  if (!capabilities.includes(ORCHESTRATION_FEDERATION_RUNTIME_CAPABILITY)) {
    throw new OrchestrationError(
      'capability_unsupported',
      `Connected server ${serverName} does not support orchestration federation.`
    )
  }
  assertWorkerLaunchPreferencesRuntimeSupported({
    model: params.model,
    effort: params.effort,
    capabilities,
    serverName
  })
  if (
    params.game &&
    !capabilities.includes(ORCHESTRATION_FEDERATION_GAME_MEMBER_RUNTIME_CAPABILITY)
  ) {
    throw new OrchestrationError(
      'capability_unsupported',
      `Connected server ${serverName} cannot run game members (${ORCHESTRATION_FEDERATION_GAME_MEMBER_RUNTIME_CAPABILITY}); update Orca there. No effects were applied.`,
      { capability: ORCHESTRATION_FEDERATION_GAME_MEMBER_RUNTIME_CAPABILITY }
    )
  }
  const supportsControlMail = capabilities.includes(
    ORCHESTRATION_FEDERATION_CONTROL_MAIL_RUNTIME_CAPABILITY
  )
  const federationProtocolVersion =
    supportsControlMail &&
    capabilities.includes(ORCHESTRATION_FEDERATION_LIFECYCLE_SETTLEMENT_RUNTIME_CAPABILITY)
      ? ORCHESTRATION_FEDERATION_LIFECYCLE_SETTLEMENT_PROTOCOL_VERSION
      : supportsControlMail
        ? ORCHESTRATION_FEDERATION_CONTROL_MAIL_PROTOCOL_VERSION
        : 1
  return {
    federationProtocolVersion,
    gameMember: params.game
      ? { game: true, ...(params.setupAdmission ? { setupAdmission: params.setupAdmission } : {}) }
      : {},
    carriesGameScene:
      params.game === true &&
      capabilities.includes(ORCHESTRATION_FEDERATION_GAME_SCENE_RUNTIME_CAPABILITY)
  }
}

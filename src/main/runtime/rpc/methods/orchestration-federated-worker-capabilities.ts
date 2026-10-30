import type { RuntimeStatus } from '../../../../shared/runtime-types'
import {
  ORCHESTRATION_CONTRACT_RUNTIME_CAPABILITY,
  ORCHESTRATION_FEDERATION_CONTROL_MAIL_PROTOCOL_VERSION,
  ORCHESTRATION_FEDERATION_CONTROL_MAIL_RUNTIME_CAPABILITY,
  ORCHESTRATION_FEDERATION_FOLLOW_UP_PROTOCOL_VERSION,
  ORCHESTRATION_FEDERATION_FOLLOW_UP_RUNTIME_CAPABILITY,
  ORCHESTRATION_FEDERATION_GAME_MEMBER_RUNTIME_CAPABILITY,
  ORCHESTRATION_FEDERATION_GAME_SCENE_RUNTIME_CAPABILITY,
  ORCHESTRATION_FEDERATION_LIFECYCLE_SETTLEMENT_PROTOCOL_VERSION,
  ORCHESTRATION_FEDERATION_LIFECYCLE_SETTLEMENT_RUNTIME_CAPABILITY,
  ORCHESTRATION_FEDERATION_MEMBER_ACCOUNT_RUNTIME_CAPABILITY,
  ORCHESTRATION_FEDERATION_MEMBER_GLOBAL_LOGIN_RUNTIME_CAPABILITY,
  ORCHESTRATION_FEDERATION_MEMBER_REOPEN_PROTOCOL_VERSION,
  ORCHESTRATION_FEDERATION_MEMBER_REOPEN_RUNTIME_CAPABILITY,
  ORCHESTRATION_FEDERATION_RUNTIME_CAPABILITY
} from '../../../../shared/protocol-version'
import { orchestrationMigrationData } from '../../../../shared/orchestration-rpc-contract'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import type { WorkerStartInput } from './orchestration-worker-start-schema'
import { assertWorkerLaunchPreferencesRuntimeSupported } from './orchestration-worker-launch-preferences'

export type FederatedWorkerNegotiation = {
  federationProtocolVersion: 1 | 2 | 3 | 4 | 5
  /** Sent only to a host that confirmed it honors them. */
  gameMember: { game?: true; setupAdmission?: 'queue' }
  /** An older host drops the lead's scene, so it is read only for a host that keeps it. */
  carriesGameScene: boolean
  /** The typed selector, sent only to a host that resolves it against its own roster. */
  memberAccount: { account?: string }
  /** The unset policy's `auto` this host cannot honor, so its member keeps the host's global login. */
  keepsHostGlobalLogin: boolean
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
  // Why both: a host with only member-account refuses `auto` when it has no managed account (ORCA-891).
  const keepsHostGlobalLogin =
    Boolean(params.remoteAccount && params.remoteAccountByDefault) &&
    !(
      capabilities.includes(ORCHESTRATION_FEDERATION_MEMBER_ACCOUNT_RUNTIME_CAPABILITY) &&
      capabilities.includes(ORCHESTRATION_FEDERATION_MEMBER_GLOBAL_LOGIN_RUNTIME_CAPABILITY)
    )
  if (
    params.remoteAccount &&
    !keepsHostGlobalLogin &&
    !capabilities.includes(ORCHESTRATION_FEDERATION_MEMBER_ACCOUNT_RUNTIME_CAPABILITY)
  ) {
    throw new OrchestrationError(
      'capability_unsupported',
      `Connected server ${serverName} cannot pick a member account (${ORCHESTRATION_FEDERATION_MEMBER_ACCOUNT_RUNTIME_CAPABILITY}); update Orca there. No effects were applied.`,
      { capability: ORCHESTRATION_FEDERATION_MEMBER_ACCOUNT_RUNTIME_CAPABILITY }
    )
  }
  const supportsControlMail = capabilities.includes(
    ORCHESTRATION_FEDERATION_CONTROL_MAIL_RUNTIME_CAPABILITY
  )
  const supportsLifecycleSettlement =
    supportsControlMail &&
    capabilities.includes(ORCHESTRATION_FEDERATION_LIFECYCLE_SETTLEMENT_RUNTIME_CAPABILITY)
  const supportsMemberReopen =
    supportsLifecycleSettlement &&
    capabilities.includes(ORCHESTRATION_FEDERATION_MEMBER_REOPEN_RUNTIME_CAPABILITY)
  const federationProtocolVersion =
    supportsMemberReopen &&
    capabilities.includes(ORCHESTRATION_FEDERATION_FOLLOW_UP_RUNTIME_CAPABILITY)
      ? ORCHESTRATION_FEDERATION_FOLLOW_UP_PROTOCOL_VERSION
      : supportsMemberReopen
        ? ORCHESTRATION_FEDERATION_MEMBER_REOPEN_PROTOCOL_VERSION
        : supportsLifecycleSettlement
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
      capabilities.includes(ORCHESTRATION_FEDERATION_GAME_SCENE_RUNTIME_CAPABILITY),
    memberAccount:
      params.remoteAccount && !keepsHostGlobalLogin ? { account: params.remoteAccount } : {},
    keepsHostGlobalLogin
  }
}

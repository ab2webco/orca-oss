import { MOBILE_TEAM_CONTROL_RUNTIME_CAPABILITY } from '../../../src/shared/protocol-version'
import { readLeadGameState } from '../team-drawer/team-drawer-rpc'
import type { RpcClient } from '../transport/rpc-client'
import { hostLeadCallersOf, hostTeamLineOf, type HostTeamLine } from './host-team-line'

/** A host's team counts across its live leads; null when the host cannot say, so its card keeps no line. */
export async function readHostTeamLine(
  client: RpcClient,
  capabilities: readonly string[]
): Promise<HostTeamLine | null> {
  // Why: an older host refuses game.leads at dispatch, so the phone asks only when it advertises the team.
  if (!capabilities.includes(MOBILE_TEAM_CONTROL_RUNTIME_CAPABILITY)) {
    return null
  }
  const leads = await client.sendRequest('game.leads')
  if (!leads.ok) {
    return null
  }
  const states = await Promise.all(
    hostLeadCallersOf(leads.result).map((caller) =>
      readLeadGameState(client, caller)
        .then((read) => (read.status === 'ok' ? read.state : null))
        .catch(() => null)
    )
  )
  return hostTeamLineOf(states.filter((state) => state !== null))
}

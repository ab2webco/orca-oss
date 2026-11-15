import {
  agentTeamsClientSettingsOf,
  agentTeamsSettingsPatchOf,
  type AgentTeamsSettingsUpdate
} from '../../src/shared/agent-teams-client-settings'
import type { GlobalSettings } from '../../src/shared/global-settings-types'
import { settingsGetResultOf } from '../../src/shared/settings-get-result'
import type { RpcRequest, RpcRespond, RpcResponse } from './mock-server-rpc-handlers'

type AgentTeamsSource = Pick<GlobalSettings, 'orchestratorGame' | 'statusColors'>

// MOCK_STATUS_COLORS='{"attention":"#ff00aa"}' starts with those dark overrides.
let source: AgentTeamsSource = {
  orchestratorGame: undefined,
  statusColors: process.env.MOCK_STATUS_COLORS
    ? { dark: JSON.parse(process.env.MOCK_STATUS_COLORS) }
    : undefined
}

const clientSettings = () => ({
  defaultTuiAgent: 'codex',
  disabledTuiAgents: [],
  agentCmdOverrides: {},
  ...agentTeamsClientSettingsOf(source)
})

// Why the host's own builders: a hand-written shape hid #1238's flat settings read.
export function handleMockSettingsRequest(
  request: RpcRequest,
  respond: RpcRespond,
  success: (id: string, result: unknown) => RpcResponse
): boolean {
  if (request.method === 'settings.get') {
    respond(success(request.id, settingsGetResultOf(clientSettings())))
    return true
  }
  if (request.method === 'settings.update') {
    console.log('[mock] settings.update', JSON.stringify(request.params))
    const update = (request.params ?? {}) as AgentTeamsSettingsUpdate
    source = { ...source, ...agentTeamsSettingsPatchOf(source, update) }
    respond(success(request.id, { settings: clientSettings() }))
    return true
  }
  return false
}

import { describe, expect, it } from 'vitest'
import { agentTeamsSettingsRouteOf } from './agent-teams-settings-host'

const host = (id: string, lastConnected: number) => ({ id, lastConnected })

describe('agentTeamsSettingsRouteOf', () => {
  // Why the latest: Settings has no desktop of its own, and the header switches desktops.
  it('opens the desktop the phone reached last', () => {
    expect(agentTeamsSettingsRouteOf([host('a', 10), host('b', 30), host('c', 20)])).toEqual({
      pathname: '/h/[hostId]/agent-teams',
      params: { hostId: 'b' }
    })
  })

  it('has nowhere to go before a desktop is paired', () => {
    expect(agentTeamsSettingsRouteOf([])).toBeNull()
  })

  // Why raw: the router encodes params itself, so a pre-encoded id would arrive escaped.
  it('passes the host id raw for the router to encode', () => {
    expect(agentTeamsSettingsRouteOf([host('host 1/x', 1)])?.params.hostId).toBe('host 1/x')
  })
})

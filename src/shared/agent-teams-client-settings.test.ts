import { describe, expect, it } from 'vitest'
import {
  agentTeamsClientSettingsOf,
  agentTeamsSettingsPatchOf
} from './agent-teams-client-settings'

describe('agentTeamsClientSettingsOf', () => {
  it('reads the defaults when Settings holds no Agent Teams layer or colours', () => {
    expect(agentTeamsClientSettingsOf({})).toEqual({
      agentTeamsPanel: { scene: 'quest', look: 'game', style: 'pixel' },
      statusColors: {}
    })
  })

  it('reads the global scene, look and style, and only valid colours', () => {
    expect(
      agentTeamsClientSettingsOf({
        orchestratorGame: { scene: 'tamer', mode: 'zen', panel: { style: 'figures' } },
        statusColors: { dark: { success: '#3DDC97', info: 'blue' } }
      })
    ).toEqual({
      agentTeamsPanel: { scene: 'tamer', look: 'display', style: 'figures' },
      statusColors: { dark: { success: '#3ddc97' } }
    })
  })
})

describe('agentTeamsSettingsPatchOf', () => {
  it('writes nothing when the update names no Agent Teams field', () => {
    expect(agentTeamsSettingsPatchOf({ orchestratorGame: { band: true } }, {})).toEqual({})
  })

  it('sets the scene and style without dropping the rest of the global layer', () => {
    const current = {
      orchestratorGame: { band: true, scene: 'quest', panel: { tabs: { queue: false } } }
    }

    expect(
      agentTeamsSettingsPatchOf(current, { agentTeamsPanel: { scene: 'jrpg', style: 'office' } })
    ).toEqual({
      orchestratorGame: {
        band: true,
        scene: 'jrpg',
        panel: { tabs: { queue: false }, style: 'office' }
      }
    })
  })

  it("replaces one theme's palette and keeps the other theme's", () => {
    const current = { statusColors: { light: { info: '#111111' }, dark: { info: '#222222' } } }

    expect(
      agentTeamsSettingsPatchOf(current, { statusColors: { dark: { success: '#3ddc97' } } })
    ).toEqual({ statusColors: { light: { info: '#111111' }, dark: { success: '#3ddc97' } } })
  })

  it('resets a theme to its defaults when its palette is null', () => {
    const current = { statusColors: { light: { info: '#111111' }, dark: { info: '#222222' } } }

    expect(agentTeamsSettingsPatchOf(current, { statusColors: { dark: null } })).toEqual({
      statusColors: { light: { info: '#111111' } }
    })
  })
})

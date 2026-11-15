import { describe, expect, it } from 'vitest'
import { agentTeamsSettingsOf, sceneLabelOf } from './agent-teams-settings-model'

describe('agentTeamsSettingsOf', () => {
  it("reads the host's global scene and style from settings.get", () => {
    expect(
      agentTeamsSettingsOf({
        terminalFontSize: 13,
        agentTeamsPanel: { scene: 'vigilante', look: 'native', style: 'figures' },
        statusColors: { light: { info: '#000000' }, dark: { info: '#123456' } }
      })
    ).toEqual({ scene: 'vigilante', style: 'figures' })
  })

  it('has no Agent Teams settings from a host that sends none', () => {
    expect(agentTeamsSettingsOf({ terminalFontSize: 13 })).toBeNull()
    expect(agentTeamsSettingsOf(null)).toBeNull()
  })

  it('falls back to Pixel for a style it does not know', () => {
    expect(
      agentTeamsSettingsOf({
        agentTeamsPanel: { scene: 'quest', look: 'native', style: 'neon' },
        statusColors: {}
      })
    ).toEqual({ scene: 'quest', style: 'pixel' })
  })
})

describe('sceneLabelOf', () => {
  it('names the built-in scenes as the desktop does, and a custom file by its name', () => {
    expect(sceneLabelOf('quest')).toBe('Quest')
    expect(sceneLabelOf('vigilante')).toBe('Night Watch')
    expect(sceneLabelOf('jrpg')).toBe('Crystal Saga')
    expect(sceneLabelOf('tamer')).toBe('Beast Tamer')
    expect(sceneLabelOf('.orca/scenes/mario-bros.json')).toBe('mario-bros.json')
    expect(sceneLabelOf('C:\\scenes\\night.json')).toBe('night.json')
  })
})

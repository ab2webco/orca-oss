import { describe, expect, it } from 'vitest'
import { agentTeamsClientSettingsOf } from '../../../src/shared/agent-teams-client-settings'
import { settingsGetResultOf } from '../../../src/shared/settings-get-result'
import { agentTeamsSettingsOf, sceneLabelOf } from './agent-teams-settings-model'

// Why built from the host's own functions: a change to settings.get's shape fails these tests.
const hostResult = (settings: Parameters<typeof agentTeamsClientSettingsOf>[0]) =>
  settingsGetResultOf({ terminalFontSize: 13, ...agentTeamsClientSettingsOf(settings) })

describe('agentTeamsSettingsOf', () => {
  it("reads the host's global scene and style from settings.get", () => {
    expect(
      agentTeamsSettingsOf(
        hostResult({
          orchestratorGame: { scene: 'vigilante', panel: { style: 'figures' } },
          statusColors: { light: { info: '#000000' }, dark: { info: '#123456' } }
        })
      )
    ).toEqual({ scene: 'vigilante', style: 'figures' })
  })

  it('has no Agent Teams settings from a host that sends none', () => {
    expect(agentTeamsSettingsOf({ settings: { terminalFontSize: 13 } })).toBeNull()
    expect(agentTeamsSettingsOf(null)).toBeNull()
  })

  it('ignores Agent Teams fields outside the settings key', () => {
    const { settings } = hostResult({ orchestratorGame: { panel: { style: 'office' } } })
    expect(agentTeamsSettingsOf(settings)).toBeNull()
  })

  it('falls back to Pixel for a style it does not know', () => {
    expect(
      agentTeamsSettingsOf(
        settingsGetResultOf({
          agentTeamsPanel: { scene: 'jrpg', look: 'native', style: 'neon' },
          statusColors: {}
        })
      )
    ).toEqual({ scene: 'jrpg', style: 'pixel' })
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

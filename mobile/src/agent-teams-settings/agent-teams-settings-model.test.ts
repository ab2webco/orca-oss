import { describe, expect, it } from 'vitest'
import { agentTeamsClientSettingsOf } from '../../../src/shared/agent-teams-client-settings'
import { settingsGetResultOf } from '../../../src/shared/settings-get-result'
import {
  agentTeamsSettingsOf,
  darkStatusColorsOf,
  sceneLabelOf,
  statusColorRowsOf,
  statusColorsUpdateOf,
  STATUS_COLOR_SWATCHES,
  withToneColor
} from './agent-teams-settings-model'

// Why built from the host's own functions: a change to settings.get's shape fails these tests.
const hostResult = (settings: Parameters<typeof agentTeamsClientSettingsOf>[0]) =>
  settingsGetResultOf({ terminalFontSize: 13, ...agentTeamsClientSettingsOf(settings) })

describe('agentTeamsSettingsOf', () => {
  it("reads the host's global scene, style and dark status colours from settings.get", () => {
    expect(
      agentTeamsSettingsOf(
        hostResult({
          orchestratorGame: { scene: 'vigilante', panel: { style: 'figures' } },
          statusColors: { light: { info: '#000000' }, dark: { info: '#123456' } }
        })
      )
    ).toEqual({ scene: 'vigilante', style: 'figures', dark: { info: '#123456' } })
  })

  it('has no Agent Teams settings from a host that sends none', () => {
    expect(agentTeamsSettingsOf({ settings: { terminalFontSize: 13 } })).toBeNull()
    expect(agentTeamsSettingsOf(null)).toBeNull()
  })

  it('ignores Agent Teams fields outside the settings key', () => {
    const { settings } = hostResult({
      orchestratorGame: { panel: { style: 'office' } },
      statusColors: { dark: { info: '#123456' } }
    })
    expect(agentTeamsSettingsOf(settings)).toBeNull()
  })

  it('keeps only valid #rrggbb dark colours and a known style', () => {
    expect(
      agentTeamsSettingsOf(
        settingsGetResultOf({
          agentTeamsPanel: { scene: 'jrpg', look: 'native', style: 'neon' },
          statusColors: { dark: { info: 'blue', idle: '#ABCDEF' } }
        })
      )
    ).toEqual({ scene: 'jrpg', style: 'pixel', dark: { idle: '#abcdef' } })
  })
})

describe('darkStatusColorsOf', () => {
  it("reads the dark overrides from settings.get's settings key, even without the panel fields", () => {
    expect(
      darkStatusColorsOf(
        settingsGetResultOf({
          statusColors: { light: { info: '#000000' }, dark: { info: '#123456', warning: 'red' } }
        })
      )
    ).toEqual({ info: '#123456' })
  })

  it('has none from a host that sends none, or from the flat shape', () => {
    expect(darkStatusColorsOf(settingsGetResultOf({ terminalFontSize: 13 }))).toEqual({})
    expect(darkStatusColorsOf({ statusColors: { dark: { info: '#123456' } } })).toEqual({})
    expect(darkStatusColorsOf(null)).toEqual({})
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

describe('statusColorRowsOf', () => {
  it('lists the five roles on the desktop defaults with nothing edited', () => {
    const rows = statusColorRowsOf({})

    expect(rows.map((row) => [row.name, row.color, row.edited, row.warning])).toEqual([
      ['Needs you', '#ff6568', false, null],
      ['At risk', '#f5b342', false, null],
      ['Working', '#4fc3f7', false, null],
      ['Verified', '#34d399', false, null],
      ['Idle', '#a1a1a1', false, null]
    ])
  })

  it('warns with the shared checks: too close to another role, then low contrast', () => {
    const rows = statusColorRowsOf({ info: '#30d095', idle: '#202020' })

    expect(rows.find((row) => row.tone === 'info')).toMatchObject({
      color: '#30d095',
      edited: true,
      warning: 'Too close to Verified'
    })
    expect(rows.find((row) => row.tone === 'idle')?.warning).toBe('Low contrast')
  })
})

describe('status colour writes', () => {
  it('sets and clears one role, dropping the palette once nothing is edited', () => {
    const set = withToneColor({}, 'info', '#123456')
    expect(set).toEqual({ info: '#123456' })
    expect(withToneColor(set, 'info', null)).toEqual({})
  })

  it('sends only the dark palette, and null to reset it', () => {
    expect(statusColorsUpdateOf({ info: '#123456' })).toEqual({
      statusColors: { dark: { info: '#123456' } }
    })
    expect(statusColorsUpdateOf({})).toEqual({ statusColors: { dark: null } })
  })

  it('offers each default hue once as a swatch', () => {
    expect(STATUS_COLOR_SWATCHES).toContain('#ff6568')
    expect(STATUS_COLOR_SWATCHES).toContain('#e40014')
    expect(new Set(STATUS_COLOR_SWATCHES).size).toBe(STATUS_COLOR_SWATCHES.length)
    expect(STATUS_COLOR_SWATCHES.every((hex) => /^#[0-9a-f]{6}$/.test(hex))).toBe(true)
  })
})

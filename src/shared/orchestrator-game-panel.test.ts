import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ORCHESTRATOR_GAME_CONFIG,
  parseOrchestratorGameLayer,
  resolveOrchestratorGameConfig,
  type OrchestratorGameLayer
} from './orchestrator-game-config'
import { parseOrcaYaml } from './orca-yaml'
import { resolveOrchestratorGamePanel } from './orchestrator-game-panel-layers'
import {
  gamePanelLookOfLegacy,
  parseGamePanel,
  resolveGamePanel,
  withGamePanelField
} from './orchestrator-game-panel'

const legacy = DEFAULT_ORCHESTRATOR_GAME_CONFIG

describe('parseGamePanel', () => {
  it('keeps every valid key', () => {
    expect(
      parseGamePanel({
        look: 'display',
        style: 'office',
        tabs: { prs: false, queue: true, machines: false },
        advisor: false,
        arcade: true
      })
    ).toEqual({
      value: {
        look: 'display',
        style: 'office',
        tabs: { prs: false, queue: true, machines: false },
        advisor: false,
        arcade: true
      },
      warnings: []
    })
  })

  it('drops bad values and unknown keys with a warning each', () => {
    const parsed = parseGamePanel({
      look: 'zen',
      style: 'hd',
      tabs: { prs: 'no', inbox: false },
      advisor: 1,
      colour: 'red'
    })

    expect(parsed.value).toEqual({ tabs: {} })
    expect(parsed.warnings).toEqual([
      'orchestratorGame.panel.look must be game, display or plain',
      'orchestratorGame.panel.style must be figures, soft, office or pixel',
      'orchestratorGame.panel.tabs.prs must be true or false',
      'orchestratorGame.panel.tabs.inbox is not a tab that can be hidden',
      'orchestratorGame.panel.advisor must be true or false',
      'orchestratorGame.panel.colour is not a known setting'
    ])
  })

  it('rejects a panel or tabs value that is not a mapping', () => {
    expect(parseGamePanel('game')).toEqual({
      value: undefined,
      warnings: ['orchestratorGame.panel must be a mapping']
    })
    expect(parseGamePanel({ tabs: ['prs'] }).warnings).toEqual([
      'orchestratorGame.panel.tabs must be a mapping'
    ])
  })
})

describe('gamePanelLookOfLegacy', () => {
  it('maps the terminal view onto a look, every render onto Pixel', () => {
    expect(gamePanelLookOfLegacy({ ...legacy, mode: 'on', render: 'hd' })).toEqual({
      look: 'game',
      style: 'pixel'
    })
    expect(gamePanelLookOfLegacy({ ...legacy, mode: 'zen' }).look).toBe('display')
    expect(gamePanelLookOfLegacy({ ...legacy, mode: 'flat' }).look).toBe('plain')
    // Why: `off` is Show the game off, which stays its own key; the look underneath is kept.
    expect(gamePanelLookOfLegacy({ ...legacy, mode: 'off' }).look).toBe('game')
  })
})

describe('resolveGamePanel', () => {
  it('follows the legacy view with every tab, the Advisor row and the arcade on', () => {
    expect(resolveGamePanel([], { ...legacy, mode: 'zen' })).toEqual({
      look: 'display',
      style: 'pixel',
      tabs: { prs: true, queue: true, machines: true },
      advisor: true,
      arcade: true
    })
  })

  it('merges key by key and tab by tab, the later layer winning', () => {
    const panel = resolveGamePanel(
      [
        { look: 'plain', tabs: { prs: false, queue: false } },
        { style: 'figures', tabs: { queue: true } },
        { look: 'game', arcade: false }
      ],
      legacy
    )

    expect(panel).toEqual({
      look: 'game',
      style: 'figures',
      tabs: { prs: false, queue: true, machines: true },
      advisor: true,
      arcade: false
    })
  })

  it('re-checks a hand-edited Settings layer and ignores what is invalid', () => {
    const edited = {
      look: 'zen',
      tabs: { prs: 'off' }
    } as unknown as Parameters<typeof resolveGamePanel>[0][number]

    expect(resolveGamePanel([edited], legacy)).toMatchObject({
      look: 'game',
      tabs: { prs: true }
    })
  })
})

describe('withGamePanelField', () => {
  it('stores one key and removes it, and the empty panel, on inherit', () => {
    const set = withGamePanelField<OrchestratorGameLayer>({ scene: 'quest' }, 'look', 'plain')
    expect(set).toEqual({ scene: 'quest', panel: { look: 'plain' } })
    expect(withGamePanelField(set, 'look', undefined)).toEqual({
      scene: 'quest'
    })
  })

  it('stores one tab without touching the others', () => {
    const one = withGamePanelField({ panel: { tabs: { queue: false } } }, 'prs', false)
    expect(one).toEqual({ panel: { tabs: { queue: false, prs: false } } })
    expect(
      withGamePanelField(withGamePanelField(one, 'prs', undefined), 'queue', undefined)
    ).toEqual({})
  })
})

describe('orchestratorGame.panel in a layer', () => {
  it('reads the panel block from orca.yaml next to mode and render, which stay', () => {
    const parsed = parseOrchestratorGameLayer({
      mode: 'zen',
      render: 'hd',
      panel: { look: 'game', tabs: { machines: false }, sparkle: true }
    })

    expect(parsed.layer).toEqual({
      mode: 'zen',
      render: 'hd',
      panel: { look: 'game', tabs: { machines: false } }
    })
    expect(parsed.warnings).toEqual(['orchestratorGame.panel.sparkle is not a known setting'])
  })

  it("resolves the panel across global, orca.yaml and this machine's layer", () => {
    expect(
      resolveOrchestratorGamePanel({
        global: { mode: 'flat', panel: { tabs: { prs: false } } },
        project: { panel: { look: 'display' } },
        local: { panel: { tabs: { prs: true } } }
      })
    ).toMatchObject({ look: 'display', tabs: { prs: true } })
  })

  it('follows the resolved legacy view when no layer sets a look', () => {
    expect(
      resolveOrchestratorGamePanel({
        global: { mode: 'on' },
        project: { mode: 'flat' }
      }).look
    ).toBe('plain')
  })
})

describe('orchestratorGame.panel across versions and writers', () => {
  it('survives the real orca.yaml parser with nested tabs', () => {
    const parsed = parseOrcaYaml(`orchestratorGame:
  mode: zen
  panel:
    look: plain
    tabs:
      queue: false
    arcade: false
`)

    expect(parsed?.orchestratorGame).toEqual({
      mode: 'zen',
      panel: { look: 'plain', tabs: { queue: false }, arcade: false }
    })
    expect(parsed?.orchestratorGameWarnings).toBeUndefined()
  })

  it('falls back to the legacy view when an older host drops panel from its orca.yaml reply', () => {
    // An older host's parser warns on `panel` and returns the rest of the layer.
    const olderHostLayer: OrchestratorGameLayer = { mode: 'flat' }

    expect(
      resolveOrchestratorGamePanel({
        global: { panel: { tabs: { queue: false } } },
        project: olderHostLayer,
        local: { panel: { style: 'office' } }
      })
    ).toEqual({
      look: 'plain',
      style: 'office',
      tabs: { prs: true, queue: false, machines: true },
      advisor: true,
      arcade: true
    })
  })

  it('leaves the resolved terminal config untouched', () => {
    const plain = resolveOrchestratorGameConfig({ global: { mode: 'zen', render: 'hd' } })
    const withPanel = resolveOrchestratorGameConfig({
      global: { mode: 'zen', render: 'hd', panel: { look: 'game', style: 'office' } }
    })

    expect(withPanel).toEqual(plain)
  })
})

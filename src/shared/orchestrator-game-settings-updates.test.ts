import { describe, expect, it } from 'vitest'
import {
  withOrchestratorGameField,
  withOrchestratorGameProjectActions,
  withOrchestratorGameProjectField,
  withOrchestratorGameProjectLead,
  withOrchestratorGameProjectScene
} from './orchestrator-game-settings-updates'

describe('withOrchestratorGameField', () => {
  it('sets a field and drops it again when reset to inherit', () => {
    const set = withOrchestratorGameField(undefined, 'mode', 'zen')
    expect(set).toEqual({ mode: 'zen' })
    expect(withOrchestratorGameField({ mode: 'zen', hud: false }, 'mode', undefined)).toEqual({
      hud: false
    })
  })
})

describe('withOrchestratorGameProjectField', () => {
  it('overrides one field for one project without touching the others', () => {
    expect(
      withOrchestratorGameProjectField({ other: { mode: 'off' } }, 'repo1', 'rewards', false)
    ).toEqual({ other: { mode: 'off' }, repo1: { rewards: false } })
  })

  it('removes the project entry once it has no overrides left', () => {
    expect(
      withOrchestratorGameProjectField({ repo1: { hud: true } }, 'repo1', 'hud', undefined)
    ).toEqual({})
  })
})

describe('withOrchestratorGameProjectScene', () => {
  it('keeps one scene choice per project: a built-in scene clears the file and back', () => {
    const withFile = withOrchestratorGameProjectScene(
      { repo1: { scene: 'jrpg', hud: false } },
      'repo1',
      { sceneFile: '.orca/scenes/mario.json' }
    )
    expect(withFile).toEqual({ repo1: { sceneFile: '.orca/scenes/mario.json', hud: false } })
    expect(withOrchestratorGameProjectScene(withFile, 'repo1', { scene: 'tamer' })).toEqual({
      repo1: { scene: 'tamer', hud: false }
    })
  })

  it('inherits by clearing both, and drops a project left with no overrides', () => {
    expect(
      withOrchestratorGameProjectScene(
        { repo1: { sceneFile: 'a.json' }, other: { mode: 'off' } },
        'repo1',
        null
      )
    ).toEqual({ other: { mode: 'off' } })
  })
})

describe('withOrchestratorGameProjectLead', () => {
  it("sets one lead key for one project, keeping the project's other overrides", () => {
    expect(
      withOrchestratorGameProjectLead(
        { repo1: { hud: false, orchestrator: { cap: 3 } }, other: { mode: 'off' } },
        'repo1',
        'autostart',
        true
      )
    ).toEqual({
      repo1: { hud: false, orchestrator: { cap: 3, autostart: true } },
      other: { mode: 'off' }
    })
  })

  it('drops an emptied lead block, then the project once nothing is left', () => {
    expect(
      withOrchestratorGameProjectLead(
        { repo1: { hud: false, orchestrator: { model: 'opus' } } },
        'repo1',
        'model',
        undefined
      )
    ).toEqual({ repo1: { hud: false } })
    expect(
      withOrchestratorGameProjectLead(
        { repo1: { orchestrator: { label: 'Boss' } } },
        'repo1',
        'label',
        undefined
      )
    ).toEqual({})
  })
})

describe('withOrchestratorGameProjectActions', () => {
  const actions = [{ label: 'Test runs', command: 'test-runs', prompt: 'Run the QA test runs' }]

  it("replaces a project's whole action list on this machine, an empty one included", () => {
    expect(withOrchestratorGameProjectActions({ repo1: { hud: false } }, 'repo1', actions)).toEqual(
      {
        repo1: { hud: false, actions }
      }
    )
    expect(withOrchestratorGameProjectActions(undefined, 'repo1', [])).toEqual({
      repo1: { actions: [] }
    })
  })

  it('inherits orca.yaml again, dropping an entry left empty', () => {
    expect(withOrchestratorGameProjectActions({ repo1: { actions } }, 'repo1', undefined)).toEqual(
      {}
    )
  })
})

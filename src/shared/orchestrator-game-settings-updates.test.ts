import { describe, expect, it } from 'vitest'
import {
  withOrchestratorGameField,
  withOrchestratorGameProjectField
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

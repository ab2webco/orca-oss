import { describe, expect, it } from 'vitest'
import { agentTeamsNamesOf, agentTeamsNamesPatchOf } from './agent-teams-names-settings'

describe('agentTeamsNamesOf', () => {
  it('reads an unset global layer as no names, with the scene roster in use', () => {
    const names = agentTeamsNamesOf({ orchestratorGame: { scene: 'vigilante' } })
    expect(names.leadName).toBeNull()
    expect(names.memberNames).toBeNull()
    expect(names.sceneRoster?.[0]).toBe('Nightjar')
  })

  it('reads the lead name and member names the global layer sets', () => {
    expect(
      agentTeamsNamesOf({
        orchestratorGame: {
          orchestrator: { label: 'Ada', memberNames: ['Bo', { en: 'Cy', es: 'Ci' }] }
        }
      })
    ).toMatchObject({ leadName: 'Ada', memberNames: ['Bo', 'Cy'] })
  })

  it('has no scene roster for a scene file, which the phone cannot read', () => {
    expect(
      agentTeamsNamesOf({ orchestratorGame: { scene: '/scenes/mine.json' } }).sceneRoster
    ).toBeNull()
  })

  it('reads Quest with no scene set, as the game draws it', () => {
    expect(agentTeamsNamesOf({}).sceneRoster?.[0]).toBe('Arthur')
  })
})

describe('agentTeamsNamesPatchOf', () => {
  const current = {
    orchestratorGame: {
      scene: 'quest',
      orchestrator: { agent: 'claude', label: 'Ada', memberNames: ['Bo'] }
    }
  }

  it('writes the names into the global lead layer and keeps the rest', () => {
    expect(agentTeamsNamesPatchOf(current, { leadName: 'Max', memberNames: ['Ann'] })).toEqual({
      orchestratorGame: {
        scene: 'quest',
        orchestrator: { agent: 'claude', label: 'Max', memberNames: ['Ann'] }
      }
    })
  })

  it('clears a name with null, so the lead is Lead and members take the scene roster', () => {
    expect(
      agentTeamsNamesPatchOf(current, { leadName: null, memberNames: null }).orchestratorGame
        ?.orchestrator
    ).toEqual({ agent: 'claude' })
  })

  it('leaves a name the update omits', () => {
    expect(
      agentTeamsNamesPatchOf(current, { leadName: 'Max' }).orchestratorGame?.orchestrator
        ?.memberNames
    ).toEqual(['Bo'])
  })
})

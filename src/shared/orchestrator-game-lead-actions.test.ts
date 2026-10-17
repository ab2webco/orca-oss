import { describe, expect, it } from 'vitest'

import { GAME_LEAD_ACTIONS, gameStateActionsOf } from './orchestrator-game-lead-actions'
import { DEFAULT_GAME_LEAD } from './orchestrator-game-lead'

const project = [
  { id: 'action-0', label: 'Test runs', command: 'test-runs', prompt: 'Run the QA test runs' },
  { id: 'action-1', label: 'Mine', command: 'wave', prompt: 'My own wave' }
]

describe('gameStateActionsOf', () => {
  it("puts Orca's lead buttons first for the lead, each naming its verb and command", () => {
    const actions = gameStateActionsOf({ role: 'lead', lead: DEFAULT_GAME_LEAD, project })
    expect(actions.map((one) => [one.id, one.command])).toEqual([
      ['lead:wave', 'wave'],
      ['lead:status', 'status'],
      ['lead:push', 'push'],
      ['lead:sweep', 'sweep'],
      ['lead:stop', 'stop'],
      ['action-0', 'test-runs'],
      ['action-1', undefined]
    ])
    expect(GAME_LEAD_ACTIONS.find((one) => one.id === 'lead:wave')).toMatchObject({
      prompt:
        'Run a wave now: fill every free member slot from my To Do with `game wave`, then tell me what you launched.'
    })
    expect(GAME_LEAD_ACTIONS.find((one) => one.id === 'lead:stop')).toMatchObject({
      prompt:
        'Stop every member now and hold the STOP with `game stop --all --hold`; confirm, and resume only when I say so.'
    })
  })

  it('keeps only the project actions for a member or when the project turns them off', () => {
    const member = gameStateActionsOf({ role: 'member', lead: DEFAULT_GAME_LEAD, project })
    const off = gameStateActionsOf({
      role: 'lead',
      lead: { ...DEFAULT_GAME_LEAD, actions: false },
      project
    })
    for (const actions of [member, off]) {
      expect(actions.map((one) => [one.id, one.command])).toEqual([
        ['action-0', 'test-runs'],
        ['action-1', 'wave']
      ])
    }
  })
})

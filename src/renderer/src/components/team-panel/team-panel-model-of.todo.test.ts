import { describe, expect, it, vi } from 'vitest'
import type { OrchestratorGameState } from '../../../../shared/orchestrator-game-state'
import type { TeamCards } from '../../../../shared/team-panel-member-cards'
import { teamPanelModelOf } from './team-panel-model-of'

vi.mock('../../../../shared/team-panel-member-cards', () => ({
  teamCardsOf: () =>
    ({
      lead: { paneKey: 'lead' },
      members: [{ paneKey: 'm1', host: { kind: 'local' }, ticket: { identifier: 'ORCA-1' } }]
    }) as unknown as TeamCards
}))

const todoItem = (id: string) => ({
  id,
  title: id,
  url: '',
  group: 'todo',
  prompt: `Work on ${id}`
})

// Why (ORCA-717): the + menu reads To Do from the model the panel already polls, never game.state again.
describe('teamPanelModelOf To Do', () => {
  it('carries the To Do tickets no member holds', () => {
    const state = {
      role: 'lead',
      agents: [],
      stopped: null,
      project: {
        reviews: null,
        todo: {
          provider: 'plane',
          total: 2,
          url: null,
          items: [todoItem('ORCA-1'), todoItem('ORCA-2')]
        }
      }
    } as unknown as OrchestratorGameState

    const model = teamPanelModelOf({ repoId: 'r', projectName: 'p', state, questions: [] })

    expect(model?.todo).toEqual([
      { identifier: 'ORCA-2', title: 'ORCA-2', prompt: 'Work on ORCA-2' }
    ])
  })

  it("carries the agent the project's members run, and none from a host that sends no lead", () => {
    const base = { role: 'lead', agents: [], stopped: null }
    const withLead = { ...base, lead: { autostart: false, cap: 4, agent: 'codex' } }
    const modelOf = (state: unknown) =>
      teamPanelModelOf({
        repoId: 'r',
        projectName: 'p',
        state: state as OrchestratorGameState,
        questions: []
      })

    expect(modelOf(withLead)?.memberAgent).toBe('codex')
    expect(modelOf(base)).not.toHaveProperty('memberAgent')
  })
})

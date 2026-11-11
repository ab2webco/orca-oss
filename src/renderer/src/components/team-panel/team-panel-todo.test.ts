import { describe, expect, it } from 'vitest'
import type { OrchestratorGameState } from '../../../../shared/orchestrator-game-state'
import type { TeamMemberCard } from '../../../../shared/team-panel-model-types'
import { teamTodoTicketsOf } from './team-panel-todo'

const item = (id: string, group?: string, prompt?: string) => ({
  id,
  title: `Title ${id}`,
  url: `https://plane/${id}`,
  ...(group ? { group } : {}),
  ...(prompt ? { prompt } : {})
})

const stateWith = (items: ReturnType<typeof item>[] | null): OrchestratorGameState =>
  ({
    project: items
      ? { reviews: null, todo: { provider: 'plane', total: 3, url: null, items } }
      : undefined
  }) as unknown as OrchestratorGameState

const memberOn = (identifier: string) =>
  ({ ticket: { identifier, title: null } }) as unknown as TeamMemberCard

// Why (ORCA-717): the + menu's Add a member names a ticket the team can still take.
describe('teamTodoTicketsOf', () => {
  it("lists the project's To Do tickets with the prompt work-on sends the lead", () => {
    const state = stateWith([item('ORCA-1', 'todo', 'Work on ORCA-1'), item('ORCA-2', 'progress')])

    expect(teamTodoTicketsOf(state, [])).toEqual([
      { identifier: 'ORCA-1', title: 'Title ORCA-1', prompt: 'Work on ORCA-1' }
    ])
  })

  it('leaves out a ticket a member already holds', () => {
    const state = stateWith([item('ORCA-1', 'todo'), item('ORCA-2', 'todo')])

    expect(teamTodoTicketsOf(state, [memberOn('orca-1')]).map((one) => one.identifier)).toEqual([
      'ORCA-2'
    ])
  })

  it('writes the default work-on prompt when an older host sends none', () => {
    const state = stateWith([item('ORCA-3', 'todo')])

    expect(teamTodoTicketsOf(state, [])[0]?.prompt).toBe(
      'Work on ORCA-3: Title ORCA-3\nhttps://plane/ORCA-3'
    )
  })

  it('has none when the host publishes no To Do list', () => {
    expect(teamTodoTicketsOf(stateWith(null), [])).toEqual([])
  })
})

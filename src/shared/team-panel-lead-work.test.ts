import { describe, expect, it } from 'vitest'
import type { GameAction } from './orchestrator-game-actions'
import type { GameProjectItem, GameProjectList } from './orchestrator-game-project-work'
import type { OrchestratorGameState } from './orchestrator-game-state'
import { teamLeadWorkOf, teamListActionOf } from './team-panel-lead-work'

const ticket = (id: string, over: Partial<GameProjectItem> = {}): GameProjectItem => ({
  id,
  title: `Title of ${id}`,
  url: `https://tracker.test/${id}`,
  prompt: `Work on ${id}`,
  ...over
})

const todoList = (
  items: GameProjectItem[],
  over: Partial<GameProjectList> = {}
): GameProjectList => ({
  provider: 'plane',
  total: items.length,
  url: 'https://tracker.test/board',
  items,
  ...over
})

const stateOf = (over: Partial<OrchestratorGameState>): OrchestratorGameState =>
  over as OrchestratorGameState

const withTodo = (todo: GameProjectList | null, actions?: GameAction[]): OrchestratorGameState =>
  stateOf({ project: { reviews: null, todo }, actions })

const PROMPT_ACTION: GameAction = { id: 'action-0', label: 'Deploy', prompt: 'Deploy it' }
const MCP_ACTION: GameAction = {
  id: 'action-1',
  label: 'Page',
  mcp: { server: 'pager', tool: 'page' }
}

describe('teamLeadWorkOf', () => {
  it('leaves To Do and Actions out for an older host that sends neither', () => {
    expect(teamLeadWorkOf(stateOf({}))).toEqual({ todo: null, actions: [] })
  })

  it('leaves To Do out with the tracker off', () => {
    expect(teamLeadWorkOf(withTodo(null)).todo).toBeNull()
  })

  it('reads an empty To Do as a list, so the panel can say so', () => {
    expect(teamLeadWorkOf(withTodo(todoList([]))).todo).toEqual({
      groups: [],
      total: 0,
      hidden: 0,
      listUrl: 'https://tracker.test/board',
      listAction: null
    })
  })

  it('heads tickets by status, counting every ticket and drawing three under each heading', () => {
    const items = ['A', 'B', 'C', 'D'].map((id) => ticket(id, { group: 'in_progress' }))
    const list = todoList([...items, ticket('E', { group: 'done' })], {
      total: 9,
      groups: { in_progress: 8, done: 1 }
    })

    const todo = teamLeadWorkOf(withTodo(list)).todo

    expect(todo?.groups.map((one) => [one.heading, one.count, one.rows.length])).toEqual([
      ['in_progress', 8, 3],
      ['other', 1, 1]
    ])
    expect(todo?.hidden).toBe(5)
  })

  it('merges the statuses one heading stands for', () => {
    const list = todoList([ticket('A', { group: 'done' }), ticket('B', { group: 'cancelled' })], {
      groups: { done: 2, cancelled: 3 }
    })

    expect(teamLeadWorkOf(withTodo(list)).todo?.groups).toMatchObject([
      { heading: 'other', count: 5 }
    ])
  })

  it('draws a list with no status groups under no heading, five at most', () => {
    const items = ['A', 'B', 'C', 'D', 'E', 'F'].map((id) => ticket(id))

    const todo = teamLeadWorkOf(withTodo(todoList(items))).todo

    expect(todo?.groups).toHaveLength(1)
    expect(todo?.groups[0]).toMatchObject({ heading: null, count: null })
    expect(todo?.groups[0]?.rows).toHaveLength(5)
    expect(todo?.hidden).toBe(1)
  })

  it('keeps "work on" off a ticket with no prompt', () => {
    const list = todoList([ticket('A', { prompt: undefined })])

    expect(teamLeadWorkOf(withTodo(list)).todo?.groups[0]?.rows[0]?.prompt).toBeNull()
  })

  it('offers only the actions the panel can send, never a disabled MCP one', () => {
    const work = teamLeadWorkOf(withTodo(null, [PROMPT_ACTION, MCP_ACTION]))

    expect(work.actions).toEqual([{ id: 'action-0', label: 'Deploy', prompt: 'Deploy it' }])
  })
})

describe('teamListActionOf', () => {
  it('runs the action the list names', () => {
    const list = todoList([], { actionId: 'action-0' })

    expect(teamListActionOf(list, [PROMPT_ACTION])?.id).toBe('action-0')
  })

  it('falls back to the list link for an MCP action or one the state lost', () => {
    expect(teamListActionOf(todoList([], { actionId: 'action-1' }), [MCP_ACTION])).toBeNull()
    expect(teamListActionOf(todoList([], { actionId: 'gone' }), [PROMPT_ACTION])).toBeNull()
  })

  it('has nothing to run on a list that names no action', () => {
    expect(teamListActionOf(todoList([]), [PROMPT_ACTION])).toBeNull()
  })
})

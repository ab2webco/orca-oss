import { afterEach, describe, expect, it } from 'vitest'

import type { GameProjectItem, GameProjectList, GameState, GameStatusGroup } from '../types'
import { stateChipsOf, type BandChip } from '../hooks/band-chips'
import { ACTION_HOTKEYS, actionErrorOf, actionResultOf } from '../hooks/action-results'
import { gameStateOf } from '../hooks/game-state'
import { todoDrawnCountOf, todoSectionsOf } from '../hooks/todo-sections'
import { setGameLocale } from '../hooks/game-strings'
import { actionChipsOf, actionLabelOf, commandPromptOf } from '../hooks/lead-actions'

const STATE: GameState = {
  config: {},
  warnings: [],
  worktree: { id: 'repo::/w', path: '/w', branch: 'main', displayName: 'w' },
  agents: [],
  review: null,
  workItem: null,
  extensions: { scenes: [] },
  links: [],
  activity: null
}

const PROMPT_ACTION = { id: 'action-0', label: 'Ship it', prompt: 'Open a PR for ORCA-1' }
const MCP_ACTION = {
  id: 'action-1',
  label: 'Test runs',
  mcp: { server: 'claude.ai Tambora', tool: 'list_test_runs', args: { project: 'CIN' } }
}

const itemOf = <G extends string>(id: string, group?: G) => ({
  id,
  title: `Ticket ${id}`,
  url: `https://plane.example/${id}`,
  ...(group === undefined ? {} : { group })
})

const ticketOf = (id: string, group?: GameStatusGroup): GameProjectItem => itemOf(id, group)

describe('project actions from Orca', () => {
  it('keeps a prompt action and an MCP action with its arguments', () => {
    const state = gameStateOf({ ...STATE, actions: [PROMPT_ACTION, MCP_ACTION] })
    expect(state?.actions).toEqual([PROMPT_ACTION, MCP_ACTION])
  })

  it("keeps each action's slash command and drops one that is not a short lowercase name", () => {
    const state = gameStateOf({
      ...STATE,
      actions: [
        { id: 'lead:wave', label: 'Wave', command: 'wave', prompt: 'Run a wave' },
        { ...MCP_ACTION, command: ' test-runs ' },
        { id: 'action-2', label: 'Bad', command: '/Bad', prompt: 'x' }
      ]
    })
    expect(state?.actions).toEqual([
      { id: 'lead:wave', label: 'Wave', command: 'wave', prompt: 'Run a wave' },
      { ...MCP_ACTION, command: 'test-runs' },
      { id: 'action-2', label: 'Bad', prompt: 'x' }
    ])
  })

  it('drops malformed actions and keeps at most eleven: the lead five and six of the project', () => {
    const malformed = [
      { id: 'action-0', prompt: 'no label' },
      { id: 'action-1', label: 'x'.repeat(25), prompt: 'too long a label' },
      { id: 'action-2', label: 'Both', prompt: 'p', mcp: { server: 's', tool: 't' } },
      { id: 'action-3', label: 'Neither' },
      { id: 'action-4', label: 'Huge', prompt: 'x'.repeat(2001) },
      { id: 'action-5', label: 'Server', mcp: { server: 'bad/server', tool: 't' } },
      { id: 'action-6', label: 'Tool', mcp: { server: 's', tool: 'has space' } },
      { id: 'action-7', label: 'Args', mcp: { server: 's', tool: 't', args: ['x'] } },
      { id: 'action-8', label: 'Args', mcp: { server: 's', tool: 't', args: 'x' } },
      { label: 'No id', prompt: 'p' },
      'not an action'
    ]
    expect(gameStateOf({ ...STATE, actions: malformed })?.actions).toBeUndefined()
    const many = Array.from({ length: 13 }, (_, at) => ({
      id: `action-${at}`,
      label: `Action ${at}`,
      prompt: `Do ${at}`
    }))
    expect(gameStateOf({ ...STATE, actions: many })?.actions?.map((one) => one.id)).toEqual(
      Array.from({ length: 11 }, (_, at) => `action-${at}`)
    )
  })

  it('trims a label and the MCP names and keeps a 24-character label', () => {
    const state = gameStateOf({
      ...STATE,
      actions: [
        { id: 'action-0', label: ` ${'y'.repeat(24)} `, mcp: { server: ' s ', tool: ' t ' } }
      ]
    })
    expect(state?.actions).toEqual([
      { id: 'action-0', label: 'y'.repeat(24), mcp: { server: 's', tool: 't' } }
    ])
  })

  it('parses a host older than actions exactly as before', () => {
    expect(gameStateOf(STATE)).toEqual(STATE)
    expect(gameStateOf({ ...STATE, actions: 'nope' })).toEqual(STATE)
  })
})

describe('the To Do grouped by status', () => {
  it('keeps each ticket group and work prompt and the counts over every open ticket', () => {
    const state = gameStateOf({
      ...STATE,
      project: {
        reviews: null,
        todo: {
          provider: 'plane',
          total: 9,
          url: 'https://plane.example/todo',
          items: [{ ...itemOf('ORCA-1', 'in_progress'), prompt: 'Work on ORCA-1' }],
          groups: { in_progress: 1, review: 3, todo: 5 }
        }
      }
    })
    expect(state?.project?.todo?.items).toEqual([
      { ...itemOf('ORCA-1', 'in_progress'), prompt: 'Work on ORCA-1' }
    ])
    expect(state?.project?.todo?.groups).toEqual({ in_progress: 1, review: 3, todo: 5 })
  })

  it('drops an unknown group, an oversized prompt and counts that are not whole', () => {
    const state = gameStateOf({
      ...STATE,
      project: {
        reviews: null,
        todo: {
          provider: 'plane',
          total: 2,
          url: null,
          items: [
            { ...itemOf('ORCA-1', 'someday'), prompt: 'x'.repeat(2001) },
            { ...itemOf('ORCA-2', 'review'), prompt: 42 }
          ],
          groups: { review: -1, todo: 1.5, backlog: '3', someday: 2, in_progress: 2 }
        }
      }
    })
    expect(state?.project?.todo?.items).toEqual([itemOf('ORCA-1'), itemOf('ORCA-2', 'review')])
    expect(state?.project?.todo?.groups).toEqual({ in_progress: 2 })
  })

  it('leaves out groups when none is valid, so an issue list reads as before', () => {
    const todo = { provider: 'github', total: 1, url: null, items: [itemOf('#1')] }
    const state = gameStateOf({
      ...STATE,
      project: { reviews: null, todo: { ...todo, groups: 3 } }
    })
    expect(state?.project?.todo).toEqual(todo)
  })

  it('heads tickets per group in the order they arrive, each with its count', () => {
    const list: GameProjectList = {
      provider: 'plane',
      total: 9,
      url: null,
      items: [
        ticketOf('A', 'in_progress'),
        ticketOf('B', 'review'),
        ticketOf('C', 'review'),
        ticketOf('D', 'todo'),
        ticketOf('E', 'backlog'),
        ticketOf('F', 'unknown')
      ],
      groups: { in_progress: 1, review: 4, todo: 2, unknown: 1, done: 1 }
    }
    expect(
      todoSectionsOf(list).map((one) => [one.heading, one.count, one.items.map((item) => item.id)])
    ).toEqual([
      ['in_progress', 1, ['A']],
      ['review', 4, ['B', 'C']],
      ['todo', 2, ['D']],
      ['backlog', undefined, ['E']],
      ['other', 2, ['F']]
    ])
  })

  it('draws at most a few tickets per section, the wire carrying more for the lead', () => {
    const list: GameProjectList = {
      provider: 'jira',
      total: 20,
      url: null,
      items: [
        ...['A', 'B', 'C', 'D', 'E'].map((id) => ticketOf(id, 'in_progress')),
        ...['F', 'G', 'H', 'I'].map((id) => ticketOf(id, 'todo'))
      ],
      groups: { in_progress: 5, todo: 15 }
    }
    const sections = todoSectionsOf(list)
    expect(
      sections.map((one) => [one.heading, one.count, one.items.map((item) => item.id)])
    ).toEqual([
      ['in_progress', 5, ['A', 'B', 'C']],
      ['todo', 15, ['F', 'G', 'H']]
    ])
    expect(todoDrawnCountOf(sections)).toBe(6)
  })

  it('draws an ungrouped list as one section with no heading', () => {
    const list: GameProjectList = {
      provider: 'github',
      total: 2,
      url: null,
      items: [ticketOf('#1'), ticketOf('#2')]
    }
    expect(todoSectionsOf(list)).toEqual([{ heading: null, items: list.items }])
  })
})

describe('the QA chip', () => {
  const chipsOf = (groups?: GameProjectList['groups']): BandChip[] =>
    stateChipsOf(
      {
        ...STATE,
        project: {
          reviews: null,
          todo: {
            provider: 'plane',
            total: 5,
            url: 'https://plane.example/todo',
            items: [],
            ...(groups === undefined ? {} : { groups })
          }
        }
      },
      { working: 0, idle: 0, done: 0, waiting: 0 },
      0,
      '',
      false
    )

  it('counts the tickets waiting on QA, green, opening the To Do, after the To Do chip', () => {
    const chips = chipsOf({ review: 2, todo: 3 })
    const qa = chips.find((one) => one.key === 'band-qa')
    const todo = chips.find((one) => one.key === 'band-todo')
    expect(qa).toMatchObject({
      labels: ['✓ QA 2', '✓ 2'],
      href: 'https://plane.example/todo',
      color: 'green',
      isLink: true
    })
    expect(qa?.priority).toBeGreaterThan(todo?.priority ?? Infinity)
  })

  it('draws no QA chip with nothing in QA or no groups', () => {
    expect(chipsOf({ review: 0, todo: 3 }).some((one) => one.key === 'band-qa')).toBe(false)
    expect(chipsOf().some((one) => one.key === 'band-qa')).toBe(false)
  })
})

describe('an MCP action result', () => {
  it('keeps the text blocks as lines, at most 12 of at most 200 characters', () => {
    const result = actionResultOf({
      isError: false,
      content: [
        { type: 'text', text: 'first\nsecond' },
        { type: 'image', mimeType: 'image/png' },
        {
          type: 'text',
          text: `${'z'.repeat(250)}\n${Array.from({ length: 20 }, String).join('\n')}`
        }
      ]
    })
    expect(result.status).toBe('done')
    expect(result.lines).toHaveLength(12)
    expect(result.lines.slice(0, 3)).toEqual(['first', 'second', 'z'.repeat(200)])
    expect(result.lines.every((one) => one.length <= 200)).toBe(true)
  })

  it('drops blank lines and reads a failed call as an error', () => {
    expect(
      actionResultOf({ isError: true, content: [{ type: 'text', text: '\n  \nno access\n' }] })
    ).toEqual({ status: 'error', lines: ['no access'] })
  })

  it('turns a thrown error into an error with its message', () => {
    expect(actionErrorOf(new Error('server not connected'))).toEqual({
      status: 'error',
      lines: ['server not connected']
    })
    expect(actionErrorOf('plain')).toEqual({ status: 'error', lines: ['plain'] })
  })

  it('uses hotkeys no other pane button takes', () => {
    expect(ACTION_HOTKEYS).toEqual(['e', 'f', 'h', 'j', 'k', 'l'])
  })
})

describe("the lead's buttons", () => {
  const LEAD = [
    { id: 'lead:wave', label: 'Wave', command: 'wave', prompt: 'Run a wave' },
    { id: 'lead:status', label: 'Status', command: 'status', prompt: 'How are they?' },
    { id: 'lead:push', label: 'Push', command: 'push', prompt: 'Push them' },
    { id: 'lead:sweep', label: 'Sweep', command: 'sweep', prompt: 'Sweep them' },
    { id: 'lead:stop', label: 'Stop', command: 'stop', prompt: 'Stop them' }
  ]

  afterEach(() => setGameLocale('en'))

  it("names Orca's own buttons in the session language and a project's by its label", () => {
    setGameLocale('es')
    expect([...LEAD, PROMPT_ACTION].map(actionLabelOf)).toEqual([
      'Ola',
      'Estado',
      'Reactivar',
      'Barrer',
      'Detener',
      'Ship it'
    ])
    expect(actionLabelOf({ id: 'lead:dance', label: 'Dance', prompt: 'x' })).toBe('Dance')
  })

  it('draws one chip per action, in order, the later ones dropped first', () => {
    const chips = actionChipsOf([...LEAD, PROMPT_ACTION])
    expect(chips.map((one) => [one.key, one.labels[0]])).toEqual([
      ['band-action-lead:wave', '▸ Wave'],
      ['band-action-lead:status', '▸ Status'],
      ['band-action-lead:push', '▸ Push'],
      ['band-action-lead:sweep', '▸ Sweep'],
      ['band-action-lead:stop', '▸ Stop'],
      ['band-action-action-0', '▸ Ship it']
    ])
    expect(chips.map((one) => one.priority)).toEqual([0, 1, 2, 3, 4, 5])
    expect(chips[0]?.labels.at(-1)).toBe('Wave')
  })

  it('appends what the person typed after the command to the prompt', () => {
    expect(commandPromptOf('Run a wave', '  CIN-1,CIN-2 ')).toBe('Run a wave\n\nCIN-1,CIN-2')
    expect(commandPromptOf('Run a wave', '   ')).toBe('Run a wave')
  })
})

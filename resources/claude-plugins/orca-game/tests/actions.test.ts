// Runs under `claude plugin test`: the Panel's project actions and "work on" a To Do ticket.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const ORCA_CLI = '/opt/orca/bin/orca'

const STATE = {
  config: {},
  warnings: [],
  worktree: { id: 'repo-1::/w', path: '/w', branch: 'feat/game', displayName: 'game' },
  agents: [
    {
      paneKey: 'tab-1:lead',
      displayName: 'lead',
      agentType: 'claude',
      state: 'working',
      toolName: null,
      isLeader: true
    }
  ],
  review: null,
  workItem: null,
  links: [],
  activity: null,
  actions: [
    { id: 'action-0', label: 'Ship it', prompt: 'Open a PR for ORCA-1' },
    {
      id: 'action-1',
      label: 'Test runs',
      mcp: { server: 'Tambora', tool: 'list_test_runs', args: { project: 'CIN' } }
    }
  ],
  project: {
    reviews: null,
    todo: {
      provider: 'plane',
      total: 4,
      url: 'https://plane.example/todo',
      items: [
        {
          id: 'ORCA-1',
          title: 'Doing',
          url: 'https://plane.example/ORCA-1',
          status: 'In Progress',
          group: 'in_progress',
          prompt: 'Work on ORCA-1: Doing'
        },
        {
          id: 'ORCA-2',
          title: 'Check',
          url: 'https://plane.example/ORCA-2',
          status: 'QA',
          group: 'review',
          prompt: 'Work on ORCA-2: Check'
        }
      ],
      groups: { in_progress: 1, review: 3 }
    }
  }
}

type World = {
  prompts: string[]
  mcp: { server: string; tool: string; args: Record<string, unknown> }[]
  toasts: string[]
  mcpFails: boolean
}

const engine = (on: On, world: World) => {
  mock.env(on, { ORCA_GAME_CLI: ORCA_CLI })
  on('session.start', ($s, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.root', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 's1' }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.toast', ($s, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: [] }) as never)
  on('ui.status', () => ({ value: undefined }))
  on('prompt.submit', ($s, e) => {
    world.prompts.push(e.text)
    return { text: e.text }
  })
  on('mcp.call', ($s, e) => {
    world.mcp.push({ server: e.server, tool: e.tool, args: e.args })
    return world.mcpFails
      ? { value: { isError: true, content: [{ type: 'text', text: 'no access' }] } }
      : { value: { isError: false, content: [{ type: 'text', text: 'TR-1 passed\nTR-2 failed' }] } }
  })
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout: JSON.stringify(STATE),
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false
    }
  }))
}

type Drawn = { type?: unknown; props?: { text?: unknown }; children?: unknown }
const isDrawn = (one: unknown): one is Drawn => typeof one === 'object' && one !== null
const shownOf = (one: unknown): string =>
  typeof one === 'string'
    ? one
    : isDrawn(one) && Array.isArray(one.children)
      ? one.children.map(shownOf).join('')
      : ''

const start = async ($: Engine, on: On, world: World) => {
  const clock = mock.clock(on)
  engine(on, world)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await clock.settle()
  return clock
}

const pane = ($: Engine) =>
  $.ui.mount({
    plugin: 'orca-game',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'orca-game-fleet',
    viewport: { columns: 124, rows: 60, isFullscreen: true },
    props: {
      title: 'Fleet',
      isFocused: true,
      bodyColumns: 120,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 50 },
      view: {}
    }
  })

const worldOf = (patch: Partial<World> = {}): World => ({
  prompts: [],
  mcp: [],
  toasts: [],
  mcpFails: false,
  ...patch
})

describe('project actions in the Panel', () => {
  test('a prompt action sends its prompt to the lead on e and says so', async ($, on) => {
    const world = worldOf()
    await start($, on, world)
    const ui = await pane($)
    expect(await ui.find({ type: 'Button', key: 'action-action-0' })).toMatchObject({
      props: { hotkey: 'e' }
    })
    await ui.press({ key: 'action-action-0' })
    expect(world.prompts).toEqual(['Open a PR for ORCA-1'])
    expect(world.toasts).toEqual(['Sent to the lead: Ship it'])
    await ui.unmount()
  })

  test('an MCP action shows what it runs, calls it on f and draws its lines', async ($, on) => {
    const world = worldOf()
    const clock = await start($, on, world)
    const ui = await pane($)
    const button = await ui.find({ type: 'Button', key: 'action-action-1' })
    expect(button).toMatchObject({ props: { hotkey: 'f' } })
    expect(shownOf(button)).toContain('Tambora·list_test_runs')
    await ui.press({ key: 'action-action-1' })
    await clock.settle()
    expect(world.mcp).toEqual([
      { server: 'Tambora', tool: 'list_test_runs', args: { project: 'CIN' } }
    ])
    expect(world.prompts).toEqual([])
    const result = await ui.find({ type: 'Box', key: 'action-result-action-1' })
    expect(shownOf(result)).toContain('TR-1 passed')
    expect(shownOf(result)).toContain('TR-2 failed')
    await ui.unmount()
  })

  test('a failed MCP call draws its error in red', async ($, on) => {
    const world = worldOf({ mcpFails: true })
    const clock = await start($, on, world)
    const ui = await pane($)
    await ui.press({ key: 'action-action-1' })
    await clock.settle()
    const error = await ui.find({ type: 'Text', text: /no access/ })
    expect(error).toMatchObject({ props: { color: 'red' } })
    await ui.unmount()
  })
})

describe('/quest demo', () => {
  test('shows actions and work buttons that only toast, never sending or calling', async ($, on) => {
    const world = worldOf()
    const clock = await start($, on, world)
    await $.command.run({ command: 'quest', args: 'demo' } as never)
    const ui = await pane($)
    await ui.press({ key: 'action-action-0' })
    await ui.press({ key: 'action-action-1' })
    await ui.press({ key: 'work-ORCA-4' })
    await clock.settle()
    expect(world.prompts).toEqual([])
    expect(world.mcp).toEqual([])
    expect(world.toasts).toEqual([
      'Demo: Open a PR is not run',
      'Demo: Test runs is not run',
      'Demo: Work on ORCA-4 is not run'
    ])
    expect(await ui.find({ type: 'Text', text: /^QA \/ review 2$/ })).toBeDefined()
    await ui.unmount()
  })
})

describe('the To Do in the Panel', () => {
  test('heads tickets by status with counts and works on one with ▶', async ($, on) => {
    const world = worldOf()
    await start($, on, world)
    const ui = await pane($)
    expect(await ui.find({ type: 'Text', text: /^In progress 1$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^QA \/ review 3$/ })).toBeDefined()
    await ui.press({ key: 'work-ORCA-2' })
    expect(world.prompts).toEqual(['Work on ORCA-2: Check'])
    expect(world.toasts).toEqual(['Sent to the lead: Work on ORCA-2'])
    await ui.unmount()
  })
})

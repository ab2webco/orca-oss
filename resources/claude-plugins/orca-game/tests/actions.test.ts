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
  state?: unknown
  env?: Record<string, string>
  registered: string[]
}

const engine = (on: On, world: World) => {
  mock.env(on, { ORCA_GAME_CLI: ORCA_CLI, ...world.env })
  on('command.register', ($s, e) => {
    // Why: Claude Code refuses a plugin the name of one of its own commands, like /status.
    if (e.name === 'status') {
      throw new Error('status is a built-in command')
    }
    world.registered.push(e.name)
    return { value: { command: e.name } }
  })
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
  on('turn.complete', () => ({ text: 'ok' }))
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
      stdout: JSON.stringify(world.state ?? STATE),
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
  registered: [],
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

describe('a button pressed repeatedly', () => {
  test('sends its prompt once, then again after the cooldown', async ($, on) => {
    const world = worldOf()
    const clock = await start($, on, world)
    const ui = await pane($)
    await ui.press({ key: 'action-action-0' })
    await ui.press({ key: 'action-action-0' })
    await ui.press({ key: 'work-ORCA-2' })
    await ui.press({ key: 'work-ORCA-2' })
    await clock.settle()
    expect(world.prompts).toEqual(['Open a PR for ORCA-1', 'Work on ORCA-2: Check'])
    expect(world.toasts.filter((one) => one === 'Sent to the lead: Ship it')).toHaveLength(2)

    await clock.advance(3001)
    await ui.press({ key: 'action-action-0' })
    expect(world.prompts).toEqual([
      'Open a PR for ORCA-1',
      'Work on ORCA-2: Check',
      'Open a PR for ORCA-1'
    ])
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

const LEAD_ACTIONS = [
  { id: 'lead:wave', label: 'Wave', command: 'wave', prompt: 'Run a wave now' },
  { id: 'lead:status', label: 'Status', command: 'status', prompt: 'How are the members?' },
  { id: 'lead:push', label: 'Push', command: 'push', prompt: 'Push the stopped ones' },
  { id: 'lead:sweep', label: 'Sweep', command: 'sweep', prompt: 'Sweep the finished ones' },
  { id: 'lead:stop', label: 'Stop', command: 'stop', prompt: 'Stop every member' }
]
const LEAD_STATE = {
  ...STATE,
  role: 'lead',
  actions: [
    ...LEAD_ACTIONS,
    {
      id: 'action-0',
      label: 'Test runs',
      command: 'runs',
      mcp: { server: 'Tambora', tool: 'list_test_runs', args: { project: 'CIN' } }
    }
  ]
}

describe('actions as slash commands', () => {
  test('registers each command once, skipping and noting one the engine refuses', async ($, on) => {
    const world = worldOf({ state: LEAD_STATE })
    const clock = await start($, on, world)
    await $.turn.complete({
      reason: 'answer',
      answer: 'ok',
      durationMs: 1,
      isAborted: false,
      turnId: 't1'
    } as never)
    await clock.settle()
    expect(world.registered.filter((one) => one !== 'quest')).toEqual([
      'wave',
      'push',
      'sweep',
      'stop',
      'runs'
    ])
    expect(world.toasts.filter((one) => one.startsWith('/status'))).toHaveLength(1)
  })

  test('/wave sends its prompt to the lead with what the person typed after it', async ($, on) => {
    const world = worldOf({ state: LEAD_STATE })
    const clock = await start($, on, world)
    await $.command.run({ command: 'wave', args: 'CIN-1,CIN-2' } as never)
    await clock.settle()
    expect(world.prompts).toEqual(['Run a wave now\n\nCIN-1,CIN-2'])
    expect(world.toasts).toContain('Sent to the lead: Wave')
  })

  test('an MCP action run as a command answers with what the tool said', async ($, on) => {
    const world = worldOf({ state: LEAD_STATE })
    const clock = await start($, on, world)
    const ran = await $.command.run({ command: 'runs', args: '' } as never)
    await clock.settle()
    expect(world.mcp).toEqual([
      { server: 'Tambora', tool: 'list_test_runs', args: { project: 'CIN' } }
    ])
    expect(ran.text).toContain('TR-1 passed')
  })
})

describe("the lead's buttons in the band", () => {
  const band = ($: Engine) =>
    $.ui.mount({
      plugin: 'orca-game',
      surface: 'terminal',
      component: 'AbovePrompt',
      viewport: { columns: 124, rows: 40, isFullscreen: true },
      props: {
        hasSurvey: false,
        isWorking: false,
        maxRows: 8,
        bodyColumns: 120,
        scroll: { offset: 0, bodyRows: 7 },
        view: {}
      }
    })

  test('draws them in the session language and sends a pressed one to the lead', async ($, on) => {
    const world = worldOf({ state: LEAD_STATE, env: { ORCA_GAME_LOCALE: 'es' } })
    await start($, on, world)
    const ui = await band($)
    const row = await ui.find({ type: 'Box', key: 'band-actions-band-action-lead:wave' })
    expect(shownOf(row)).toContain('Ola')
    expect(shownOf(row)).toContain('Detener')
    expect(shownOf(row)).toContain('Test runs')
    await ui.press({ key: 'band-action-lead:wave' })
    expect(world.prompts).toEqual(['Run a wave now'])
    expect(world.toasts).toContain('Enviado al líder: Ola')
    await ui.unmount()
  })
})

describe('a To Do that runs an action', () => {
  const TODO_STATE = {
    ...STATE,
    project: { ...STATE.project, todo: { ...STATE.project.todo, actionId: 'action-0' } }
  }

  test('the t link, the Panel heading and the band chip send its prompt instead of opening the list', async ($, on) => {
    const world = worldOf({ state: TODO_STATE })
    const clock = await start($, on, world)
    const ui = await pane($)
    await ui.press({ key: 'open-todo' })
    await clock.advance(3001)
    await ui.press({ key: 'project-todo-action' })
    await ui.unmount()
    await clock.advance(3001)
    const strip = await $.ui.mount({
      plugin: 'orca-game',
      surface: 'terminal',
      component: 'AbovePrompt',
      viewport: { columns: 164, rows: 40, isFullscreen: true },
      props: {
        hasSurvey: false,
        isWorking: false,
        maxRows: 8,
        bodyColumns: 160,
        scroll: { offset: 0, bodyRows: 7 },
        view: {}
      }
    })
    await strip.press({ key: 'band-todo' })
    await clock.settle()
    expect(world.prompts).toEqual([
      'Open a PR for ORCA-1',
      'Open a PR for ORCA-1',
      'Open a PR for ORCA-1'
    ])
    await strip.unmount()
  })
})

describe('a PR list that runs an action', () => {
  const PRS_STATE = {
    ...STATE,
    project: {
      ...STATE.project,
      reviews: {
        provider: 'github',
        total: 0,
        url: 'https://github.com/o/r/pulls',
        items: [],
        actionId: 'action-0'
      }
    }
  }

  test('the g link and the Panel heading send its prompt instead of opening the list', async ($, on) => {
    const world = worldOf({ state: PRS_STATE })
    const clock = await start($, on, world)
    const ui = await pane($)
    await ui.press({ key: 'open-reviews' })
    await clock.advance(3001)
    await ui.press({ key: 'project-reviews-action' })
    await clock.settle()
    expect(world.prompts).toEqual(['Open a PR for ORCA-1', 'Open a PR for ORCA-1'])
    await ui.unmount()
  })
})

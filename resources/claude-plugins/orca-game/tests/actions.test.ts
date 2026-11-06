// Runs under `claude plugin test`: the Panel's project actions and "work on" a To Do ticket.
import { describe, expect, mock } from 'claude-code/testing'
import { test } from './test-budget'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { allWidgetsStore } from './all-widgets-store'

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
  isDefaultLayout?: boolean
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
  on('store.get', ($s, e) => ({
    value:
      e.key === 'panel-layout' && world.isDefaultLayout !== true
        ? allWidgetsStore(['repo-1', 'demo'])
        : undefined
  }))
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

const start = async ($: Engine, on: On, world: World) => {
  const clock = mock.clock(on)
  engine(on, world)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await clock.settle()
  return clock
}

const worldOf = (patch: Partial<World> = {}): World => ({
  prompts: [],
  mcp: [],
  toasts: [],
  mcpFails: false,
  registered: [],
  ...patch
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

  test('a failed MCP action answers with its error', async ($, on) => {
    const world = worldOf({ state: LEAD_STATE, mcpFails: true })
    const clock = await start($, on, world)
    const ran = await $.command.run({ command: 'runs', args: '' } as never)
    await clock.settle()
    expect(ran.text).toContain('no access')
  })

  // Why: the buttons moved out of the terminal (ORCA-1055); a retyped command must not queue the turn twice.
  test('sends a prompt once, then again after the cooldown', async ($, on) => {
    const world = worldOf({ state: LEAD_STATE })
    const clock = await start($, on, world)
    await $.command.run({ command: 'wave', args: '' } as never)
    await $.command.run({ command: 'wave', args: '' } as never)
    await clock.settle()
    expect(world.prompts).toEqual(['Run a wave now'])

    await clock.advance(3001)
    await $.command.run({ command: 'wave', args: '' } as never)
    await clock.settle()
    expect(world.prompts).toEqual(['Run a wave now', 'Run a wave now'])
  })

  test('says a lead action in the session language', async ($, on) => {
    const world = worldOf({ state: LEAD_STATE, env: { ORCA_GAME_LOCALE: 'es' } })
    const clock = await start($, on, world)
    await $.command.run({ command: 'wave', args: '' } as never)
    await clock.settle()
    expect(world.toasts).toContain('Enviado al líder: Ola')
  })
})

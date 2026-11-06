// Runs under `claude plugin test`, against the engine itself; the *.spec.ts files are vitest's.
import { describe, expect, mock } from 'claude-code/testing'
import { test } from './test-budget'
import type { On } from 'claude-code'

const VIEWPORT = { columns: 170, rows: 40, isFullscreen: true } as const
const TURN = {
  reason: 'answer',
  answer: 'ok',
  durationMs: 1,
  isAborted: false,
  turnId: 't1'
} as const
const ORCA_CLI = '/opt/orca/bin/orca'
const GAME_STATE = [ORCA_CLI, 'game', 'state', '--json']

const agent = (displayName: string, state: string, toolName: string | null, isLeader = false) => ({
  paneKey: `tab-1:${displayName}`,
  displayName,
  agentType: 'claude',
  state,
  toolName,
  isLeader
})

const review = (state: string, ci: string) => ({
  provider: 'github',
  number: 42,
  title: 'feat: game',
  url: 'https://github.com/o/r/pull/42',
  state,
  ci
})

const STATE = {
  config: {},
  sources: {},
  warnings: [],
  worktree: { id: 'wt-1', path: '/w', branch: 'feat/game', displayName: 'game' },
  agents: [
    agent('lead', 'working', 'Edit', true),
    agent('builder', 'working', 'Edit'),
    agent('tester', 'waiting', null)
  ],
  review: review('open', 'failure'),
  workItem: {
    provider: 'plane',
    identifier: 'ORCA-580',
    title: 'Game',
    url: 'https://plane.example/ORCA-580',
    status: 'In Progress',
    statusGroup: 'in_progress'
  }
}

type World = {
  env?: Record<string, string>
  stdout: string | null
  calls: string[][]
  opened: string[]
  toasts: string[]
  store: Record<string, unknown>
  /** Other commands that exit 0, with no output. */
  succeeds?: (argv: readonly string[]) => boolean
}

const worldOf = (patch: Partial<World> = {}): World => ({
  stdout: JSON.stringify({ id: 'x', ok: true, result: STATE }),
  calls: [],
  opened: [],
  toasts: [],
  store: {},
  ...patch
})

const engine = (on: On, world: World) => {
  mock.env(on, { ORCA_GAME_CLI: ORCA_CLI, ...world.env })
  on('session.start', ($s, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.root', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 's1' }))
  on('turn.complete', () => ({ text: 'ok' }))
  on('ui.toast', ($s, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', ($s, e) => {
    world.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('store.get', ($s, e) => ({ value: world.store[e.key] }))
  on('store.set', ($s, e) => {
    world.store[e.key] = e.value
    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: [] }) as never)
  on('process.run', ($s, e) => {
    world.calls.push([...e.argv])
    const isGame = e.argv.join(' ') === GAME_STATE.join(' ')
    const stdout = isGame ? world.stdout : world.succeeds?.(e.argv) ? '' : null
    return {
      value: {
        exitCode: stdout === null ? 1 : 0,
        stdout: stdout ?? '',
        stderr: stdout === null ? 'no' : '',
        isStdoutTruncated: false,
        isStderrTruncated: false
      }
    }
  })
}

const polls = (world: World) =>
  world.calls.filter((argv) => argv.join(' ') === GAME_STATE.join(' ')).length

describe('band', () => {
  test('polls every 30 s and after each turn', async ($, on) => {
    const world = worldOf()
    const clock = mock.clock(on)
    engine(on, world)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    await clock.advance(30000)
    expect(polls(world)).toBe(2)
    await clock.advance(5000)
    await $.turn.complete(TURN)
    await clock.settle()
    expect(polls(world)).toBe(3)
  })
})

describe('language', () => {
  // Why: Orca Lab dropped ja/ko/zh (ORCA-596), so an older Orca's ja launch gets English, while
  // CJK names agents report still reach the text and the art keeps drawing.

  test('a reply card names its character in the launch language', async ($, on) => {
    const world = worldOf({ env: { ORCA_GAME_LOCALE: 'es' } })
    const clock = mock.clock(on)
    engine(on, world)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    const reply = await $.ui.mount({
      plugin: 'orca-game',
      surface: 'terminal',
      component: 'AssistantMessage',
      viewport: VIEWPORT,
      props: { text: 'Listo.', isFirstOfReply: true }
    })
    // The open review puts the fleet in the pr phase, whose character is the Herald.
    expect(await reply.find({ type: 'Text', text: /^Heraldo · abriendo el PR$/ })).toBeDefined()
    await reply.unmount()
  })

  // Why: the env is fixed at launch, so a UI language change reaches a running pane only through the state.
})

describe('rewards', () => {
  const merged = JSON.stringify({ ...STATE, review: review('merged', 'success') })
  const open = JSON.stringify({ ...STATE, review: review('open', 'pending') })

  test('a merge seen between two polls earns XP once and keeps it in the store', async ($, on) => {
    const world = worldOf({ stdout: open })
    const clock = mock.clock(on)
    engine(on, world)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    world.stdout = merged
    await clock.advance(30000)
    await clock.advance(30000)
    expect(world.store['xp-ledger']).toMatchObject({ total: 120 })
  })

  const fleetOf = (prState: string) =>
    JSON.stringify({
      ...STATE,
      role: 'lead',
      worktree: { id: 'wt-main', path: '/w', branch: 'main', displayName: 'main' },
      review: null,
      workItem: null,
      agents: [
        agent('lead', 'working', null, true),
        {
          ...agent('ORCA-12', 'working', 'Edit'),
          isMember: true,
          worktree: { id: 'wt-12', branch: 'feat/orca-12', displayName: 'orca-12' },
          review: { ...review(prState, 'success'), number: 41 }
        }
      ]
    })

  test("a lead earns XP when a member's PR merges, though it has no PR of its own", async ($, on) => {
    const world = worldOf({ stdout: fleetOf('open') })
    const clock = mock.clock(on)
    engine(on, world)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    expect(world.store['xp-ledger']).toBeUndefined()
    world.stdout = fleetOf('merged')
    await clock.advance(30000)
    await clock.advance(30000)
    expect(world.store['xp-ledger']).toMatchObject({ total: 100 })
    expect(world.toasts).toEqual(['+100 XP · ORCA-12 · #41 merged'])
  })

  test('ORCA_GAME_REWARDS=0 earns nothing for the fleet either', async ($, on) => {
    const world = worldOf({ stdout: fleetOf('open'), env: { ORCA_GAME_REWARDS: '0' } })
    const clock = mock.clock(on)
    engine(on, world)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    world.stdout = fleetOf('merged')
    await clock.advance(30000)
    expect(world.store['xp-ledger']).toBeUndefined()
    expect(world.toasts).toEqual([])
  })

  test('ORCA_GAME_REWARDS=0 earns nothing', async ($, on) => {
    const world = worldOf({ stdout: open, env: { ORCA_GAME_REWARDS: '0' } })
    const clock = mock.clock(on)
    engine(on, world)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    world.stdout = merged
    await clock.advance(30000)
    expect(world.store['xp-ledger']).toBeUndefined()
  })
})

describe('lead autostart', () => {
  const leadWorld = (role: 'lead' | 'member', autostart: boolean) =>
    worldOf({
      stdout: JSON.stringify({
        id: 'x',
        ok: true,
        result: { ...STATE, lead: { autostart, cap: 4, agent: 'claude' }, role }
      })
    })

  const startCounting = (on: On) => {
    const ran: string[] = []
    on('command.run', { command: 'orca-game:lead' }, ($s, e) => {
      ran.push(e.command)
      return { text: '' }
    })
    return ran
  }

  test('loads the lead rules once in a project that asks for it', async ($, on) => {
    const world = leadWorld('lead', true)
    const clock = mock.clock(on)
    engine(on, world)
    const ran = startCounting(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    expect(ran).toEqual(['orca-game:lead'])
    expect(world.store['lead-started-sessions']).toEqual(['s1'])

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    expect(ran).toEqual(['orca-game:lead'])
  })

  test('never makes a member or a project without autostart the lead', async ($, on) => {
    const clock = mock.clock(on)
    engine(on, leadWorld('member', true))
    const ran = startCounting(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    expect(ran).toEqual([])
  })
})

describe('lead name', () => {
  const namedWorld = (label: string, role: 'lead' | 'member' = 'lead') =>
    worldOf({
      stdout: JSON.stringify({
        id: 'x',
        ok: true,
        result: {
          ...STATE,
          agents: [agent('lead', 'working', 'Edit', true)],
          lead: { autostart: true, cap: 4, agent: 'claude', label },
          role
        }
      })
    })

  const startCounting = (on: On) => {
    const renames: string[] = []
    on('command.run', { command: 'orca-game:lead' }, () => ({ text: '' }))
    on('command.run', { command: 'rename' }, ($s, e) => {
      renames.push(e.args)
      return { text: '' }
    })
    return renames
  }

  test('names a started lead session after the label and follows a new label', async ($, on) => {
    const world = namedWorld('Orquestador')
    const clock = mock.clock(on)
    engine(on, world)
    const renames = startCounting(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    await $.turn.complete({ ...TURN })
    await clock.settle()
    expect(renames).toEqual(['Orquestador'])

    world.stdout = namedWorld('Capitán').stdout
    await $.turn.complete({ ...TURN })
    await clock.settle()
    await $.turn.complete({ ...TURN })
    await clock.settle()
    expect(renames).toEqual(['Orquestador', 'Capitán'])
  })

  test('names the session once the person runs the lead skill in a project without autostart', async ($, on) => {
    const world = namedWorld('Orquestador')
    world.stdout = (world.stdout ?? '').replace('"autostart":true', '"autostart":false')
    const clock = mock.clock(on)
    engine(on, world)
    const renames = startCounting(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    await $.turn.complete({ ...TURN })
    await clock.settle()
    expect(renames).toEqual([])
    await $.command.run({
      command: 'orca-game:lead',
      args: '',
      origin: { kind: 'composer' }
    } as never)
    await $.turn.complete({ ...TURN })
    await clock.settle()
    expect(renames).toEqual(['Orquestador'])
  })

  test('never renames a session the person named', async ($, on) => {
    const world = namedWorld('Orquestador')
    const clock = mock.clock(on)
    engine(on, world)
    const renames = startCounting(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    await $.turn.complete({ ...TURN })
    await clock.settle()
    await $.command.run({
      command: 'rename',
      args: 'mine',
      origin: { kind: 'composer' }
    } as never)
    world.stdout = namedWorld('Capitán').stdout
    await $.turn.complete({ ...TURN })
    await clock.settle()
    await $.turn.complete({ ...TURN })
    await clock.settle()
    expect(renames).toEqual(['Orquestador', 'mine'])
  })

  test('never renames a member, even one whose session ran the lead skill', async ($, on) => {
    const world = namedWorld('Orquestador', 'member')
    world.store = { 'lead-started-sessions': ['s1'] }
    const clock = mock.clock(on)
    engine(on, world)
    const renames = startCounting(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    await $.turn.complete({ ...TURN })
    await clock.settle()
    expect(renames).toEqual([])
  })
})

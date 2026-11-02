// Runs under `claude plugin test`, against the engine itself; the *.spec.ts files are vitest's.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { QUEST_SCENE } from '../hooks/scenes/quest'
import { VIGILANTE_SCENE } from '../hooks/scenes/vigilante'

const VIEWPORT = { columns: 170, rows: 40, isFullscreen: true } as const
const BAND = {
  component: 'AbovePrompt',
  viewport: VIEWPORT,
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 8,
    bodyColumns: 160,
    scroll: { offset: 0, bodyRows: 7 },
    view: {}
  }
} as const
const SPINNER = {
  component: 'Spinner',
  viewport: VIEWPORT,
  props: { word: 'Working', message: null, suffix: '', mode: 'thinking' }
} as const
const PANE = {
  component: 'Pane',
  requestId: 'orca-game-fleet',
  viewport: VIEWPORT,
  props: {
    title: 'Fleet',
    isFocused: true,
    bodyColumns: 140,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {}
  }
} as const
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
  test('draws the party, the review, the work item and who needs you from orca game state', async ($, on) => {
    const world = worldOf()
    const clock = mock.clock(on)
    engine(on, world)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    expect(polls(world)).toBe(1)

    const ui = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Raster' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Team 2 teammates$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^1 working$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^1 waiting on you$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /#42 open · CI failing/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /ORCA-580 In Progress/ })).toBeDefined()
    const needs = await ui.find({ type: 'Box', key: 'band-needs' })
    expect(await ui.find({ type: 'Text', text: /^Needs you:$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^tester waiting on you$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^#42 CI failing$/ })).toBeDefined()
    expect(needs).toBeDefined()
    await ui.press({ key: 'band-refresh' })
    await clock.settle()
    expect(polls(world)).toBe(2)
    await ui.press({ key: 'band-panel' })
    expect(world.opened).toEqual(['orca-game-fleet'])
    await ui.unmount()

    const pane = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...PANE })
    expect(await pane.find({ type: 'Text', text: /^builder$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^lead$/ })).toBeDefined()
    await pane.unmount()
  })

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

  test('with no Orca CLI there is no fleet data, nothing throws, and the scene still draws', async ($, on) => {
    const world = worldOf({ stdout: null })
    const clock = mock.clock(on)
    engine(on, world)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Text', text: /orca game state unavailable/ })).toBeDefined()
    expect(await ui.find({ type: 'Raster' })).toBeUndefined()
    await ui.unmount()
    const spinner = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...SPINNER })
    expect(await spinner.find({ type: 'Raster' })).toBeDefined()
    await spinner.unmount()
  })

  test('without an absolute ORCA_GAME_CLI it runs nothing, not even a bare orca', async ($, on) => {
    const world = worldOf({ env: { ORCA_GAME_CLI: 'orca' } })
    const clock = mock.clock(on)
    engine(on, world)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    expect(world.calls).toEqual([])
    const ui = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Text', text: /orca game state unavailable/ })).toBeDefined()
    await ui.unmount()
  })

  test('a plugin scene Orca serves paints the band, and an unknown one falls back to quest', async ($, on) => {
    const orbit = { ...QUEST_SCENE, band: { ...QUEST_SCENE.band, gold: '#123456' } }
    const served = (scene: string) =>
      JSON.stringify({
        ...STATE,
        config: { scene },
        extensions: {
          scenes: [{ id: 'acme.space/orbit', pluginId: 'acme.space', definition: orbit }]
        }
      })
    const world = worldOf({ stdout: served('acme.space/orbit') })
    const clock = mock.clock(on)
    engine(on, world)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    const panelColor = async () => {
      const ui = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...BAND })
      const panel = await ui.find({ type: 'Text', text: / ▤ Panel / })
      await ui.unmount()
      return panel?.props.backgroundColor
    }
    expect(await panelColor()).toBe('#123456')
    world.stdout = served('acme.space/gone')
    await clock.advance(30000)
    expect(await panelColor()).toBe(QUEST_SCENE.band.gold)
  })

  test('ORCA_GAME_HUD=0 hides the band', async ($, on) => {
    const world = worldOf({ env: { ORCA_GAME_HUD: '0' } })
    const clock = mock.clock(on)
    engine(on, world)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Text', text: /^Team/ })).toBeUndefined()
    expect(await ui.find({ type: 'Raster' })).toBeUndefined()
    await ui.unmount()
  })
})

describe('fleet pane', () => {
  test('View focuses a teammate pane through the Orca CLI; a tile with no valid handle has none', async ($, on) => {
    const agents = [
      { ...agent('lead', 'working', 'Edit', true), terminalHandle: 'term_lead' },
      { ...agent('builder', 'working', 'Edit'), terminalHandle: 'term_builder' },
      { ...agent('tester', 'waiting', null), terminalHandle: '--help' }
    ]
    const world = worldOf({ stdout: JSON.stringify({ ...STATE, agents }) })
    const clock = mock.clock(on)
    engine(on, world)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    const pane = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...PANE })
    expect(await pane.find({ type: 'Button', key: 'view-tab-1:lead' })).toBeDefined()
    expect(await pane.find({ type: 'Button', key: 'view-tab-1:builder' })).toBeDefined()
    expect(await pane.find({ key: 'view-tab-1:tester' })).toBeUndefined()
    await pane.press({ key: 'view-tab-1:builder' })
    await clock.settle()
    expect(world.calls).toContainEqual([
      ORCA_CLI,
      'terminal',
      'focus',
      '--terminal',
      'term_builder',
      '--json'
    ])
    await pane.unmount()
  })

  // Why: a remote member's handle resolves only on its host; View opens it here through the pairing (ORCA-839).
  test("View on a live remote member opens its host's terminal in this window", async ($, on) => {
    const remote = {
      ...agent('ORCA-839 view', 'working', null),
      paneKey: 'remote:ctx_839',
      isMember: true,
      terminalHandle: 'term_839',
      remote: { host: 'imac', environmentId: 'env-imac', stateKnown: true }
    }
    const agents = [agent('lead', 'working', 'Edit', true), remote]
    const world = worldOf({ stdout: JSON.stringify({ ...STATE, agents }) })
    const clock = mock.clock(on)
    engine(on, world)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    const pane = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...PANE })
    await pane.press({ key: 'view-remote:ctx_839' })
    await clock.settle()
    expect(world.calls).toContainEqual([
      ORCA_CLI,
      'terminal',
      'focus',
      '--terminal',
      'term_839',
      '--on',
      'env-imac',
      '--json'
    ])
    await pane.unmount()
  })
})

describe('quest mode', () => {
  test('ORCA_GAME_MODE=off starts plain, and /quest overrides it for the session', async ($, on) => {
    const world = worldOf({ env: { ORCA_GAME_MODE: 'off' } })
    const clock = mock.clock(on)
    engine(on, world)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    const show = await $.command.run({ command: 'quest', args: '' } as never)
    expect(show).toMatchObject({ text: expect.stringMatching(/^Quest: off\./) })
    const off = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...SPINNER })
    expect(await off.find({ type: 'Raster' })).toBeUndefined()
    await off.unmount()
    const zen = await $.command.run({ command: 'quest', args: 'zen' } as never)
    expect(zen).toMatchObject({ text: "Quest: zen (this session; the project's setting is off)." })
    const loud = await $.command.run({ command: 'quest', args: 'loud' } as never)
    expect(loud).toMatchObject({ text: expect.stringMatching(/^Unknown mode/) })
    const on2 = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...SPINNER })
    expect(await on2.find({ type: 'Raster' })).toBeDefined()
    await on2.unmount()
  })

  test('/quest demo plays a fake party and never runs the CLI; /quest on returns', async ($, on) => {
    const world = worldOf()
    const clock = mock.clock(on)
    engine(on, world)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    const before = world.calls.length
    await $.command.run({ command: 'quest', args: 'demo' } as never)
    const ui = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Text', text: /^Team 3 teammates$/ })).toBeDefined()
    await ui.press({ key: 'band-refresh' })
    await ui.unmount()
    await clock.advance(60000)
    await $.turn.complete(TURN)
    await clock.settle()
    expect(world.calls.slice(before)).toEqual([])
    expect(world.store['xp-ledger']).toBeUndefined()
    await $.command.run({ command: 'quest', args: 'on' } as never)
    const real = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...BAND })
    expect(await real.find({ type: 'Text', text: /^Team 2 teammates$/ })).toBeDefined()
    await real.unmount()
  })
})

describe('language', () => {
  test('ORCA_GAME_LOCALE=es speaks Spanish in the band, the pane and /quest', async ($, on) => {
    const world = worldOf({ env: { ORCA_GAME_LOCALE: 'es' } })
    const clock = mock.clock(on)
    engine(on, world)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Raster' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Equipo: 2 compañeros$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^1 trabajando$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^1 te espera$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /#42 abierto · CI fallando/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /ORCA-580 In Progress/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: / ↻ Actualizar / })).toBeDefined()
    await ui.unmount()
    const pane = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...PANE })
    expect(await pane.find({ type: 'Text', text: /^ ✕ Cerrar $/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^builder$/ })).toBeDefined()
    await pane.unmount()
    const loud = await $.command.run({ command: 'quest', args: 'loud' } as never)
    expect(loud).toMatchObject({ text: expect.stringMatching(/^Modo desconocido/) })
  })

  // Why: Orca Lab dropped ja/ko/zh (ORCA-596), so an older Orca's ja launch gets English, while
  // CJK names agents report still reach the text and the art keeps drawing.
  test('ORCA_GAME_LOCALE=ja draws English, with CJK teammate names, and still draws the art', async ($, on) => {
    const cjk = {
      ...STATE,
      agents: [
        agent('リーダー', 'working', 'Edit', true),
        agent('設計担当', 'working', 'Edit'),
        agent('検証担当', 'waiting', null)
      ]
    }
    const world = worldOf({
      env: { ORCA_GAME_LOCALE: 'ja' },
      stdout: JSON.stringify({ id: 'x', ok: true, result: cjk })
    })
    const clock = mock.clock(on)
    engine(on, world)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Raster' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Team 2 teammates$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^検証担当 waiting on you$/ })).toBeDefined()
    await ui.unmount()
    const spinner = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...SPINNER })
    expect(await spinner.find({ type: 'Raster' })).toBeDefined()
    await spinner.unmount()
  })

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
    expect(await reply.find({ type: 'Text', text: /^✉ Heraldo$/ })).toBeDefined()
    await reply.unmount()
  })

  test('ORCA_GAME_SCENE=vigilante paints its band and signs replies as its characters', async ($, on) => {
    const world = worldOf({ env: { ORCA_GAME_SCENE: 'vigilante', ORCA_GAME_LOCALE: 'es' } })
    const clock = mock.clock(on)
    engine(on, world)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...BAND })
    const panel = await ui.find({ type: 'Text', text: / ▤ Panel / })
    expect(panel?.props.backgroundColor).toBe(VIGILANTE_SCENE.band.gold)
    await ui.unmount()
    const reply = await $.ui.mount({
      plugin: 'orca-game',
      surface: 'terminal',
      component: 'AssistantMessage',
      viewport: VIEWPORT,
      props: { text: 'Listo.', isFirstOfReply: true }
    })
    expect(await reply.find({ type: 'Text', text: /^↗ Carrera en azoteas$/ })).toBeDefined()
    await reply.unmount()
    const spinner = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...SPINNER })
    expect(await spinner.find({ type: 'Raster' })).toBeDefined()
    await spinner.unmount()
  })

  // Why: the env is fixed at launch, so a UI language change reaches a running pane only through the state.
  test("follows Orca's UI language from the state on the next poll", async ($, on) => {
    const served = (locale: string) => JSON.stringify({ ...STATE, locale })
    const world = worldOf({ env: { ORCA_GAME_LOCALE: 'en' }, stdout: served('es') })
    const clock = mock.clock(on)
    engine(on, world)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    const teamLine = async () => {
      const ui = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...BAND })
      const found = await ui.find({ type: 'Text', text: /^(Team|Equipo)/ })
      await ui.unmount()
      return found?.children
    }
    expect(await teamLine()).toEqual(['Equipo: 2 compañeros'])
    world.stdout = served('en')
    await clock.advance(30000)
    expect(await teamLine()).toEqual(['Team 2 teammates'])
  })

  test('keeps the launch language when an older Orca sends no locale', async ($, on) => {
    const world = worldOf({ env: { ORCA_GAME_LOCALE: 'es' } })
    const clock = mock.clock(on)
    engine(on, world)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    await clock.advance(30000)
    const ui = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Text', text: /^Equipo: 2 compañeros$/ })).toBeDefined()
    await ui.unmount()
  })

  test('an unknown ORCA_GAME_LOCALE falls back to English', async ($, on) => {
    const world = worldOf({ env: { ORCA_GAME_LOCALE: 'fr' } })
    const clock = mock.clock(on)
    engine(on, world)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Text', text: /^Team 2 teammates$/ })).toBeDefined()
    await ui.unmount()
  })
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

  test('the Panel crowns the lead with the label from Settings', async ($, on) => {
    const world = namedWorld('Orquestador')
    const clock = mock.clock(on)
    engine(on, world)
    startCounting(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    const pane = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...PANE })
    expect(await pane.find({ type: 'Text', text: '♛ Orquestador' })).toBeDefined()
    await pane.unmount()
  })

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

describe('links in the system browser', () => {
  const OPEN = [ORCA_CLI, 'game', 'open-link', '--url', 'https://github.com/o/r/pull/42', '--json']
  const systemWorld = () =>
    worldOf({
      stdout: JSON.stringify({ ...STATE, config: { openLinks: 'system' } })
    })

  test('the band and the Panel open them through Orca in the system browser', async ($, on) => {
    const world = {
      ...systemWorld(),
      succeeds: (argv: readonly string[]) => argv[2] === 'open-link'
    }
    const clock = mock.clock(on)
    engine(on, world)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    const band = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...BAND })
    await band.press({ key: 'band-review' })
    await clock.settle()
    expect(world.calls.filter((argv) => argv[1] === 'game' && argv[2] === 'open-link')).toEqual([
      OPEN
    ])
    await band.unmount()
    const pane = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...PANE })
    await pane.press({ key: 'open-review' })
    await clock.settle()
    expect(world.calls.filter((argv) => argv[2] === 'open-link')).toEqual([OPEN, OPEN])
    expect(world.calls.some((argv) => argv[1] === 'tab')).toBe(false)
    await pane.unmount()
  })

  test('fall back to an Orca tab when Orca cannot open the system browser', async ($, on) => {
    const world = systemWorld()
    const clock = mock.clock(on)
    engine(on, world)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    const pane = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...PANE })
    await pane.press({ key: 'open-review' })
    await clock.settle()
    expect(world.calls.filter((argv) => argv[2] === 'open-link' || argv[1] === 'tab')).toEqual([
      OPEN,
      [
        ORCA_CLI,
        'tab',
        'create',
        '--url',
        'https://github.com/o/r/pull/42',
        '--worktree',
        'id:wt-1',
        '--json'
      ]
    ])
    await pane.unmount()
  })
})

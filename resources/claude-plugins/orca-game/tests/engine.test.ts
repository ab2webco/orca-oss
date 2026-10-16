// Runs under `claude plugin test`, against the engine itself; the *.spec.ts files are vitest's.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { QUEST_SCENE } from '../hooks/scenes/quest'

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
  store: Record<string, unknown>
}

const worldOf = (patch: Partial<World> = {}): World => ({
  stdout: JSON.stringify({ id: 'x', ok: true, result: STATE }),
  calls: [],
  opened: [],
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
  on('ui.toast', () => ({ value: undefined }))
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
    const stdout = isGame ? world.stdout : null
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
    const needs = /Needs you: tester waiting on you · #42 CI failing/
    expect(await ui.find({ type: 'Text', text: needs })).toBeDefined()
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
    expect(zen).toMatchObject({ text: 'Quest: zen.' })
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

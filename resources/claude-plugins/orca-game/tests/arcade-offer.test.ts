// Runs under `claude plugin test`: /orca-game:demo offer celebrates in the scene, offers a run in a
// pane that asks for the keyboard so its j and n never reach the prompt, counts down, and leaves
// nothing once passed or expired; an agent waiting on the user holds the countdown and the run, and
// keeps the prompt its keyboard, until it is answered.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { ARCADE_OFFER_SECONDS } from '../hooks/arcade-offer'
import { ARCADE_PANE } from '../hooks/arcade-pane'
import { POLL_EVERY_MS } from '../hooks/fleet-sync'

const MEMBER = {
  paneKey: 't:scribe',
  displayName: 'scribe',
  agentType: 'claude',
  state: 'waiting',
  toolName: null,
  isLeader: false
}

const stateWith = (agents: unknown[]) => ({
  config: { scene: 'vigilante' },
  sources: {},
  warnings: [],
  worktree: { id: 'repo-1::/w', path: '/w', branch: 'feat/game', displayName: 'game' },
  agents,
  review: null,
  workItem: null,
  links: [],
  role: 'lead'
})

const start = async ($: Engine, on: On, agents: unknown[] = []) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 25, 12) })
  mock.env(on, { ORCA_GAME_CLI: '/opt/orca/bin/orca', ORCA_GAME_LOCALE: 'en' })
  on('session.start', ($s, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.root', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 's1' }))
  const writes: string[] = []
  on('store.get', () => ({ value: undefined }))
  on('store.set', ($s, e) => {
    writes.push(e.key)
    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: [] }) as never)
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  const world = {
    agents,
    panes: [] as { id: string; isFocused: boolean }[],
    opened: [] as { id: string; focus?: boolean }[],
    closed: [] as string[]
  }
  on('ui.open', ($s, e) => {
    world.opened.push(e)
    world.panes = [{ id: e.id, isFocused: e.focus === true }]
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($s, e, next) => {
    world.closed.push(e.id)
    world.panes = world.panes.filter((one) => one.id !== e.id)
    return next(e)
  })
  on('ui.panes', () => ({
    value: world.panes.map((one) => ({ ...one, title: 'Arcade', isShown: true, isPlaced: true }))
  }))
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout: JSON.stringify({ id: 'x', ok: true, result: stateWith(world.agents) }),
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false
    }
  }))
  const blits: string[] = []
  on('ui.blit', ($s, e) => {
    if (e.requestId === ARCADE_PANE) {
      blits.push('cells' in e ? e.cells : '')
    }
    return { value: {} }
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await clock.settle()
  return { clock, world, writes, blits }
}

const arcadePane = ($: Engine, columns = 85, isFocused = true) =>
  $.ui.mount({
    plugin: 'orca-game',
    surface: 'terminal',
    component: 'Pane',
    requestId: ARCADE_PANE,
    viewport: { columns: columns + 4, rows: 40, isFullscreen: true },
    props: {
      title: 'Arcade',
      isFocused,
      bodyColumns: columns,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 30 },
      view: {}
    }
  })

const BAND = {
  plugin: 'orca-game',
  surface: 'terminal',
  component: 'AbovePrompt',
  viewport: { columns: 160, rows: 40, isFullscreen: true },
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 8,
    bodyColumns: 160,
    scroll: { offset: 0, bodyRows: 7 },
    view: {}
  }
} as const

const hasOfferLine = async ($: Engine, text: RegExp, isFocused = true): Promise<boolean> => {
  const ui = await arcadePane($, 85, isFocused)
  const line = await ui.find({ type: 'Text', text })
  await ui.unmount()
  return line !== undefined
}

const isCelebrating = async ($: Engine): Promise<boolean> => {
  const band = await $.ui.mount(BAND)
  const scene = await band.find({ type: 'Raster', key: 'band-pet-scene' })
  await band.unmount()
  return scene !== undefined
}

describe('/orca-game:demo offer', () => {
  test('celebrates in the scene and offers a run in a pane that asks for the keyboard', async ($, on) => {
    const { world } = await start($, on)
    expect(await isCelebrating($)).toBe(false)
    await $.command.run({ command: 'orca-game:demo', args: 'offer' } as never)
    expect(world.opened).toMatchObject([{ id: ARCADE_PANE, focus: true }])
    expect(await isCelebrating($)).toBe(true)
    const ui = await arcadePane($)
    expect(await ui.find({ type: 'Button', key: 'arcade-play' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'arcade-pass' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'arcade-jump' })).toBeUndefined()
    await ui.unmount()
  })

  test('counts down on screen and closes by itself at zero, with nothing kept', async ($, on) => {
    const { clock, world, writes, blits } = await start($, on)
    const before = [...writes]
    await $.command.run({ command: 'quest', args: 'demo offer' } as never)
    expect(await hasOfferLine($, new RegExp(`\\b${ARCADE_OFFER_SECONDS}s to choose`))).toBe(true)
    await clock.advance(3000)
    expect(await hasOfferLine($, new RegExp(`\\b${ARCADE_OFFER_SECONDS - 3}s to choose`))).toBe(
      true
    )
    await clock.advance(ARCADE_OFFER_SECONDS * 1000)
    expect(world.closed).toEqual([ARCADE_PANE])
    const left = await arcadePane($)
    expect(await left.find({ type: 'Raster' })).toBeUndefined()
    await left.unmount()
    expect(blits).toEqual([])
    expect(writes).toEqual(before)
  })

  test('closes on pass and plays nothing after it', async ($, on) => {
    const { clock, world, writes, blits } = await start($, on)
    const before = [...writes]
    await $.command.run({ command: 'orca-game:demo', args: 'offer' } as never)
    const ui = await arcadePane($)
    await ui.press({ key: 'arcade-pass' })
    await ui.unmount()
    expect(world.closed).toEqual([ARCADE_PANE])
    await clock.advance(30_000)
    expect(world.closed).toEqual([ARCADE_PANE])
    expect(blits).toEqual([])
    expect(writes).toEqual(before)
  })

  test('play takes the keyboard and starts the run, keeping no points from a demo', async ($, on) => {
    const { clock, world, writes, blits } = await start($, on)
    const before = [...writes]
    await $.command.run({ command: 'orca-game:demo', args: 'offer' } as never)
    const ui = await arcadePane($)
    await ui.press({ key: 'arcade-play' })
    expect(world.opened.at(-1)).toMatchObject({ id: ARCADE_PANE, focus: true })
    await clock.advance(1000)
    expect(blits.length).toBeGreaterThan(5)
    await ui.unmount()
    // The countdown is gone with the offer: the run never closes on its own.
    await clock.advance(ARCADE_OFFER_SECONDS * 1000)
    expect(world.closed).toEqual([])
    expect(await hasOfferLine($, /to choose/)).toBe(false)
    expect(writes).toEqual(before)
  })

  test('says how to reach its keys while the prompt keeps the keyboard', async ($, on) => {
    await start($, on)
    await $.command.run({ command: 'orca-game:demo', args: 'offer' } as never)
    expect(await hasOfferLine($, /ctrl\+x tab/, false)).toBe(true)
    expect(await hasOfferLine($, /ctrl\+x tab/, true)).toBe(false)
  })

  test('holds the countdown while a member waits on the user and goes on once answered', async ($, on) => {
    const { clock, world } = await start($, on, [MEMBER])
    await $.command.run({ command: 'orca-game:demo', args: 'offer' } as never)
    expect(world.opened[0]?.focus).toBeUndefined()
    await clock.advance(10_000)
    expect(world.closed).toEqual([])
    expect(await hasOfferLine($, /needs you · 15s left/)).toBe(true)
    world.agents = []
    await clock.advance(POLL_EVERY_MS)
    await clock.advance(ARCADE_OFFER_SECONDS * 1000)
    expect(world.closed).toEqual([ARCADE_PANE])
  })
})

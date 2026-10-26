// Runs under `claude plugin test`: /orca-game:demo arcade opens a practice run that costs nothing
// until played, pauses off focus, writes no XP or points, and leaves nothing once closed.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { ARCADE_PANE, ARCADE_JUMP_KEY } from '../hooks/arcade-pane'
import { ARCADE_ROWS } from '../hooks/arcade-runner-frame'

const STATE = {
  config: { scene: 'vigilante' },
  sources: {},
  warnings: [],
  worktree: { id: 'repo-1::/w', path: '/w', branch: 'feat/game', displayName: 'game' },
  agents: [],
  review: null,
  workItem: null,
  links: [],
  role: 'lead'
}

const start = async ($: Engine, on: On) => {
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
    panes: [] as { id: string; isFocused: boolean }[],
    opened: [] as unknown[],
    closed: [] as string[]
  }
  on('ui.open', ($s, e) => {
    world.opened.push(e)
    world.panes = [{ id: e.id, isFocused: true }]
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
  const runs: string[] = []
  on('process.run', ($s, e) => {
    runs.push(e.argv.slice(1).join(' '))
    return {
      value: {
        exitCode: 0,
        stdout: JSON.stringify({ id: 'x', ok: true, result: STATE }),
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false
      }
    }
  })
  const blits: string[] = []
  on('ui.blit', ($s, e) => {
    if (e.requestId === ARCADE_PANE) {
      blits.push('cells' in e ? e.cells : '')
    }
    return { value: {} }
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await clock.settle()
  return { clock, world, writes, runs, blits }
}

const arcadePane = ($: Engine, columns: number) =>
  $.ui.mount({
    plugin: 'orca-game',
    surface: 'terminal',
    component: 'Pane',
    requestId: ARCADE_PANE,
    viewport: { columns: columns + 4, rows: 40, isFullscreen: true },
    props: {
      title: 'Arcade',
      isFocused: true,
      bodyColumns: columns,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 30 },
      view: {}
    }
  })

describe('/orca-game:demo arcade', () => {
  test('opens a focused pane with the runner and one jump key, and runs nothing before a press', async ($, on) => {
    const { clock, world, blits } = await start($, on)
    await $.command.run({ command: 'orca-game:demo', args: 'arcade' } as never)
    expect(world.opened).toMatchObject([{ id: ARCADE_PANE, focus: true, closeOnEscape: true }])
    for (const columns of [160, 85, 43, 35]) {
      const ui = await arcadePane($, columns)
      const raster = await ui.find({ type: 'Raster' })
      expect(raster?.props.columns, `${columns}`).toBe(columns)
      expect(raster?.props.rows).toBe(ARCADE_ROWS)
      const jump = await ui.find({ type: 'Button', key: 'arcade-jump' })
      expect(jump?.props.hotkey).toBe(ARCADE_JUMP_KEY)
      await ui.unmount()
    }
    await clock.advance(5000)
    expect(blits).toEqual([])
  })

  test('plays at most 15 frames a second, pauses with no frames off focus, and goes on at the key', async ($, on) => {
    const { clock, world, blits } = await start($, on)
    await $.command.run({ command: 'quest', args: 'demo arcade' } as never)
    const ui = await arcadePane($, 85)
    await ui.press({ key: 'arcade-jump' })
    await clock.advance(1000)
    expect(blits.length).toBeGreaterThan(5)
    expect(blits.length).toBeLessThanOrEqual(15)
    world.panes = [{ id: ARCADE_PANE, isFocused: false }]
    await clock.advance(500)
    const paused = blits.length
    await clock.advance(5000)
    expect(blits.length).toBe(paused)
    world.panes = [{ id: ARCADE_PANE, isFocused: true }]
    await ui.press({ key: 'arcade-jump' })
    await clock.advance(1000)
    expect(blits.length).toBeGreaterThan(paused)
    await ui.unmount()
  })

  test('writes no XP or points and leaves no frames once its pane closes', async ($, on) => {
    const { clock, world, writes, runs, blits } = await start($, on)
    const before = { writes: [...writes], runs: [...runs] }
    await $.command.run({ command: 'orca-game:demo', args: 'arcade' } as never)
    const ui = await arcadePane($, 85)
    await ui.press({ key: 'arcade-jump' })
    await clock.advance(3000)
    await ui.press({ key: 'arcade-close' })
    expect(world.closed).toEqual([ARCADE_PANE])
    const closed = blits.length
    await clock.advance(5000)
    expect(blits.length).toBe(closed)
    await ui.unmount()
    // The pane redrawn after its run ended plays nothing and closes again.
    const left = await arcadePane($, 85)
    expect(await left.find({ type: 'Raster' })).toBeUndefined()
    await left.unmount()
    expect(writes).toEqual(before.writes)
    expect(runs.filter((one) => !one.startsWith('game state'))).toEqual(
      before.runs.filter((one) => !one.startsWith('game state'))
    )
  })

  // Why no key press: a test cannot raise the engine's Esc; it is the same ui.close the quit key raises.
  test('asks the engine to close the pane on Esc', async ($, on) => {
    const { world } = await start($, on)
    await $.command.run({ command: 'orca-game:demo', args: 'arcade' } as never)
    expect(world.opened).toMatchObject([{ id: ARCADE_PANE, closeOnEscape: true }])
  })

  // Why redraw before the clock moves: only the ui.close hook, Esc's path too, can have ended the run.
  test('the quit key q closes the pane at once and keeps no run behind', async ($, on) => {
    const { clock, world, writes, blits } = await start($, on)
    const before = [...writes]
    await $.command.run({ command: 'orca-game:demo', args: 'arcade' } as never)
    const ui = await arcadePane($, 35)
    const quit = await ui.find({ type: 'Button', key: 'arcade-close' })
    expect(quit?.props.hotkey).toBe('q')
    await ui.press({ key: 'arcade-jump' })
    await clock.advance(1000)
    await ui.press({ key: 'arcade-close' })
    await ui.unmount()
    expect(world.closed).toEqual([ARCADE_PANE])
    const left = await arcadePane($, 35)
    expect(await left.find({ type: 'Raster' })).toBeUndefined()
    await left.unmount()
    const closed = blits.length
    await clock.advance(5000)
    expect(blits.length).toBe(closed)
    expect(writes).toEqual(before)
  })

  test('a close the hook never hears still ends the run on its next frame', async ($, on) => {
    const { clock, world, writes, blits } = await start($, on)
    const before = [...writes]
    await $.command.run({ command: 'orca-game:demo', args: 'arcade' } as never)
    const ui = await arcadePane($, 85)
    await ui.press({ key: 'arcade-jump' })
    await clock.advance(1000)
    await ui.unmount()
    world.panes = []
    await clock.advance(1000)
    const gone = blits.length
    await clock.advance(5000)
    expect(blits.length).toBe(gone)
    const left = await arcadePane($, 85)
    expect(await left.find({ type: 'Raster' })).toBeUndefined()
    await left.unmount()
    expect(world.closed).toEqual([ARCADE_PANE])
    expect(writes).toEqual(before)
  })
})

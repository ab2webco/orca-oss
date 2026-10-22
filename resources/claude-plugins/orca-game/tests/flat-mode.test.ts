// Runs under `claude plugin test`: flat draws the game as text, with no Raster and no frame work.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'
import type { On } from 'claude-code'

import { ADVISOR_TILE_KEY } from '../hooks/advisor-tile'
import { cellWidthOf } from '../hooks/cell-width'
import { HUD_KEY } from '../hooks/fleet-hud'
import { PANE_ID } from '../hooks/fleet-pane'
import { TILE_COLUMNS } from '../hooks/fleet-tiles'
import { SCENE_TICK_MS } from '../hooks/scene'

const ADVISOR = {
  version: 1,
  locale: 'en',
  line: 'jev · 2 agents',
  model: 'Opus 5.5',
  modelId: 'claude-opus-5-5',
  effort: 'high',
  subagents: [],
  ci: [],
  notices: []
}

// Publishes TEST_ADVISOR at start, as Jev does in a game pane.
const JEV: Plugin = {
  name: 'orca-jev-mod-skills',
  register(on) {
    on('session.start', async ($, e, next) => {
      const raw = await $.env.get('TEST_ADVISOR')
      if (raw !== undefined && raw !== null && raw !== '') {
        await $.state.set({ plugin: 'orca-jev-mod-skills', key: 'advisor' }, JSON.parse(raw))
      }
      return next(e)
    })
  }
}

const agent = (name: string, isLeader: boolean) => ({
  paneKey: `t:${name}`,
  displayName: isLeader ? name : `${name} · ORCA-${name.length} work`,
  agentType: 'claude',
  state: isLeader ? 'idle' : 'working',
  toolName: isLeader ? null : 'Edit',
  isLeader,
  ...(isLeader ? {} : { isMember: true, terminalHandle: `term_${name}` })
})

const STATE = {
  config: {},
  sources: {},
  warnings: [],
  worktree: { id: 'repo-1::/w', path: '/w', branch: 'feat/game', displayName: 'game' },
  agents: [agent('lead', true), agent('builder', false), agent('tester', false)],
  review: null,
  workItem: null,
  links: [],
  role: 'lead'
}

const start = async ($: Engine, on: On, env: Record<string, string> = {}) => {
  const clock = mock.clock(on)
  mock.env(on, { ORCA_GAME_CLI: '/opt/orca/bin/orca', ORCA_GAME_LOCALE: 'en', ...env })
  on('session.start', ($s, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.root', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 's1' }))
  const store = new Map<string, unknown>()
  on('store.get', ($s, e) => ({ value: store.get(e.key) }))
  on('store.set', ($s, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: [] }) as never)
  on('ui.status', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout: JSON.stringify(STATE),
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false
    }
  }))
  const blits: string[] = []
  on('ui.blit', ($s, e) => {
    blits.push(e.key)
    return { value: {} }
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await clock.settle()
  return { clock, blits }
}

const band = ($: Engine, columns: number) =>
  $.ui.mount({
    plugin: 'orca-game',
    surface: 'terminal',
    component: 'AbovePrompt',
    viewport: { columns: columns + 4, rows: 60, isFullscreen: true },
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows: 30,
      bodyColumns: columns,
      scroll: { offset: 0, bodyRows: 29 },
      view: {}
    }
  })

const spinner = ($: Engine, columns: number) =>
  $.ui.mount({
    plugin: 'orca-game',
    surface: 'terminal',
    component: 'Spinner',
    viewport: { columns, rows: 40, isFullscreen: true },
    props: { word: 'Working', message: null, suffix: '', mode: 'thinking' }
  })

const pane = ($: Engine, columns: number) =>
  $.ui.mount({
    plugin: 'orca-game',
    surface: 'terminal',
    component: 'Pane',
    requestId: PANE_ID,
    viewport: { columns: columns + 4, rows: 60, isFullscreen: true },
    props: {
      title: 'Fleet',
      isFocused: true,
      bodyColumns: columns,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 50 },
      view: {}
    }
  })

describe('flat mode', () => {
  test('the band, spinner and Panel draw text only, within the width', async ($, on) => {
    await start($, on, { ORCA_GAME_MODE: 'flat' })
    for (const columns of [40, 60, 130]) {
      for (const ui of [
        await band($, columns),
        await spinner($, columns),
        await pane($, columns)
      ]) {
        expect(await ui.findAll({ type: 'Raster' }), `${columns}`).toEqual([])
        await ui.unmount()
      }
      const drawn = await band($, columns)
      const builder = await drawn.find({ type: 'Box', key: 'flat-member-t:builder' })
      expect(builder?.text, `${columns}`).toMatch(/^• builder {2}ORCA-7/)
      expect(cellWidthOf(builder?.text ?? ''), `${columns}`).toBeLessThanOrEqual(columns)
      expect(await drawn.find({ type: 'Box', key: 'flat-member-t:lead' })).toBeDefined()
      expect(await drawn.find({ type: 'Button', key: 'band-pet' })).toBeUndefined()
      await drawn.unmount()
    }
    const turn = await spinner($, 130)
    expect(await turn.find({ type: 'Box', key: 'flat-phase' })).toBeDefined()
    await turn.unmount()
  })

  test('no scene frame is sent while flat draws', async ($, on) => {
    const { clock, blits } = await start($, on, { ORCA_GAME_MODE: 'flat' })
    const shown = [await band($, 130), await spinner($, 130), await pane($, 130)]
    await clock.advance(SCENE_TICK_MS * 30)
    expect(blits).toEqual([])
    for (const ui of shown) {
      await ui.unmount()
    }
  })

  test("the band's toggle flips to text and back to the scene, live", async ($, on) => {
    await start($, on)
    const ui = await band($, 130)
    expect(await ui.find({ type: 'Raster', key: HUD_KEY })).toBeDefined()
    await ui.press({ key: 'band-flat' })
    await ui.redraw()
    expect(await ui.findAll({ type: 'Raster' })).toEqual([])
    expect(await ui.find({ type: 'Box', key: 'flat-member-t:tester' })).toBeDefined()
    await ui.press({ key: 'band-flat' })
    await ui.redraw()
    expect(await ui.find({ type: 'Raster', key: HUD_KEY })).toBeDefined()
    await ui.unmount()
  })

  test("the Panel's toggle flips the same mode, on hotkey 0", async ($, on) => {
    await start($, on, { ORCA_GAME_MODE: 'zen' })
    const panel = await pane($, 130)
    const toggle = await panel.find({ type: 'Button', key: 'flat' })
    expect(toggle?.props.hotkey).toBe('0')
    expect(await panel.find({ type: 'Raster', key: 'tile-t:builder' })).toBeDefined()
    await panel.press({ key: 'flat' })
    await panel.redraw()
    expect(await panel.findAll({ type: 'Raster' })).toEqual([])
    expect(await panel.find({ type: 'Button', key: 'view-t:builder' })).toBeDefined()
    await panel.press({ key: 'flat' })
    await panel.redraw()
    expect(await panel.find({ type: 'Raster', key: 'tile-t:builder' })).toBeDefined()
    await panel.unmount()
  })

  test("the Panel's collapsed team section folds the flat lines too", async ($, on) => {
    await start($, on, { ORCA_GAME_MODE: 'flat' })
    const panel = await pane($, 130)
    expect(await panel.find({ type: 'Box', key: 'flat-member-t:builder' })).toBeDefined()
    await panel.press({ key: 'layout-toggle-team' })
    await panel.redraw()
    expect(await panel.find({ type: 'Box', key: 'flat-member-t:builder' })).toBeUndefined()
    expect(await panel.find({ type: 'Button', key: 'flat' })).toBeDefined()
    await panel.press({ key: 'layout-toggle-team' })
    await panel.redraw()
    expect(await panel.find({ type: 'Box', key: 'flat-member-t:builder' })).toBeDefined()
    await panel.unmount()
  })

  test('a phone-width Panel lists the members, then one row of View chips', async ($, on) => {
    await start($, on, { ORCA_GAME_MODE: 'flat' })
    const panel = await pane($, 50)
    const row = await panel.find({ type: 'Box', key: 'flat-views-tap' })
    expect(row?.text).toContain('▸ builder')
    expect(row?.text).toContain('▸ tester')
    const keys = (await panel.findAll({ type: 'Button' })).map((one) => String(one.key))
    expect(keys).toEqual(expect.arrayContaining(['view-t:builder', 'view-t:tester']))
    await panel.unmount()
  })

  test('flat drops the empty advisor tile column', { plugins: [JEV] }, async ($, on) => {
    await start($, on, { ORCA_GAME_MODE: 'flat', TEST_ADVISOR: JSON.stringify(ADVISOR) })
    const panel = await pane($, 130)
    expect(await panel.find({ type: 'Box', key: 'advisor-card' })).toBeDefined()
    const blanks = (await panel.findAll({ type: 'Box' })).filter(
      (one) => one.props.width === TILE_COLUMNS
    )
    expect(blanks).toEqual([])
    await panel.unmount()
  })

  test('scene mode keeps the advisor sprite tile', { plugins: [JEV] }, async ($, on) => {
    await start($, on, { ORCA_GAME_MODE: 'on', TEST_ADVISOR: JSON.stringify(ADVISOR) })
    const panel = await pane($, 130)
    expect(await panel.find({ type: 'Raster', key: ADVISOR_TILE_KEY })).toBeDefined()
    await panel.unmount()
  })
})

// Runs under `claude plugin test`: with the Panel shown the band drops its team scene for the progress line.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'
import type { On } from 'claude-code'

import { cellWidthOf } from '../hooks/cell-width'
import { HUD_KEY } from '../hooks/fleet-hud'
import { PANE_ID } from '../hooks/fleet-pane'

const agent = (name: string, isLeader: boolean) => ({
  paneKey: `t:${name}`,
  displayName: name,
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
  worktree: { id: 'wt-1', path: '/w', branch: 'feat/game', displayName: 'game' },
  agents: [agent('lead', true), agent('builder', false), agent('tester', false)],
  review: null,
  workItem: null,
  links: [],
  role: 'lead',
  actions: ['wave', 'status'].map((command) => ({
    id: `lead:${command}`,
    label: command,
    command,
    prompt: `Run ${command}`
  }))
}

const FLEET = { id: PANE_ID, title: 'Fleet', isFocused: true, isPlaced: true }

const start = async (
  $: Engine,
  on: On,
  panes: readonly (typeof FLEET & { isShown: boolean })[],
  env: Record<string, string> = {}
) => {
  const clock = mock.clock(on)
  mock.env(on, { ORCA_GAME_CLI: '/opt/orca/bin/orca', ORCA_GAME_LOCALE: 'en', ...env })
  on('session.start', ($s, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.root', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 's1' }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: [] }) as never)
  on('ui.status', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: panes }))
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout: JSON.stringify(STATE),
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false
    }
  }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await clock.settle()
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

type Mounted = Awaited<ReturnType<typeof band>>

const BUTTONS = ['band-panel', 'band-refresh', 'band-pet', 'band-action-lead:wave']

/** No team scene, the progress line within the body, the buttons kept. */
const expectPanelBand = async (ui: Mounted, columns: number) => {
  expect(await ui.find({ type: 'Raster', key: HUD_KEY }), `${columns}`).toBeUndefined()
  expect(await ui.find({ type: 'Box', key: 'band-hud-line' }), `${columns}`).toBeUndefined()
  const progress = await ui.find({ type: 'Box', key: 'band-progress' })
  expect(progress?.text, `${columns}`).toMatch(/Lv \d+ [■□]+ \d+\/\d+ XP/)
  expect(cellWidthOf(progress?.text ?? '')).toBeLessThanOrEqual(columns)
  const keys = (await ui.findAll({ type: 'Button' })).map((one) => String(one.key))
  // Why `+N` may stand in for an action: a phone's band counts what does not fit.
  for (const key of BUTTONS.slice(0, 3)) {
    expect(keys, `${columns}`).toContain(key)
  }
  expect(keys.some((one) => one.startsWith('band-action'))).toBe(true)
}

const SHOWN = [{ ...FLEET, isShown: true }]
const WIDTHS = [36, 59, 80, 160] as const

describe('the band while the Panel is shown', () => {
  for (const scene of ['quest', 'vigilante', 'jrpg', 'tamer']) {
    for (const render of ['classic', 'hd']) {
      test(`${scene} in ${render} drops the team scene at every width`, async ($, on) => {
        await start($, on, SHOWN, { ORCA_GAME_SCENE: scene, ORCA_GAME_RENDER: render })
        for (const columns of WIDTHS) {
          const ui = await band($, columns)
          await expectPanelBand(ui, columns)
          await ui.unmount()
        }
      })
    }
  }

  for (const mode of ['on', 'zen', 'off']) {
    test(`mode ${mode} drops the team scene`, async ($, on) => {
      await start($, on, SHOWN, { ORCA_GAME_MODE: mode })
      for (const columns of [36, 160]) {
        const ui = await band($, columns)
        await expectPanelBand(ui, columns)
        await ui.unmount()
      }
    })
  }

  test('keeps the scene that carries the message cloud', async ($, on) => {
    await start($, on, SHOWN)
    const ui = await band($, 160)
    await ui.press({ key: 'band-pet' })
    await ui.redraw()
    expect(await ui.find({ type: 'Raster', key: 'band-pet-scene' })).toBeDefined()
    expect(await ui.find({ type: 'Raster', key: HUD_KEY })).toBeUndefined()
    await ui.unmount()
  })

  test('with rewards off draws no progress line either', async ($, on) => {
    await start($, on, SHOWN, { ORCA_GAME_REWARDS: 'false' })
    const ui = await band($, 160)
    expect(await ui.find({ type: 'Raster', key: HUD_KEY })).toBeUndefined()
    expect(await ui.find({ type: 'Box', key: 'band-progress' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'band-panel' })).toBeDefined()
    await ui.unmount()
  })
})

describe('the band with the Panel closed or behind another tab', () => {
  for (const [label, panes] of [
    ['closed', []],
    ['behind another tab', [{ ...FLEET, isShown: false }]]
  ] as const) {
    test(`${label} keeps the full band`, async ($, on) => {
      await start($, on, panes)
      const wide = await band($, 160)
      expect(await wide.find({ type: 'Raster', key: HUD_KEY })).toBeDefined()
      expect(await wide.find({ type: 'Box', key: 'band-progress' })).toBeUndefined()
      await wide.unmount()
      const phone = await band($, 36)
      expect(await phone.find({ type: 'Box', key: 'band-hud-line' })).toBeDefined()
      await phone.unmount()
    })
  }
})

const ADVISOR = {
  version: 1,
  locale: 'en',
  line: 'jev · 2 agents',
  model: 'Opus 5.5',
  modelId: 'claude-opus-5-5',
  effort: 'high',
  subagents: [],
  ci: [{ id: 'c1', status: 'success', text: 'CI main (abc1234) paso en 22 min' }],
  notices: [{ id: 'n1', level: 'warn', text: 'Run /clear soon' }]
}

// Inline plugins close over nothing of this file, so they read what to do from the env.
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

const SCOUT: Plugin = {
  name: 'scout',
  register(on) {
    on('session.start', ($, e, next) => {
      $.ui.status('3 scouts out')
      return next(e)
    })
  }
}

const ADVISED = { plugins: [JEV, SCOUT] }
const ADVICE_ENV = { TEST_ADVISOR: JSON.stringify(ADVISOR) }
const JEV_LINE = /jev · 2 agents/
const JEV_CI = /CI main \(abc1234\)/
const JEV_NOTICE = /Run \/clear soon/

describe('the band strip while the Panel is shown', () => {
  test('draws no Jev row and keeps another plugin status', ADVISED, async ($, on) => {
    await start($, on, SHOWN, ADVICE_ENV)
    const ui = await band($, 160)
    expect(await ui.find({ type: 'Text', text: JEV_LINE })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: JEV_CI })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: JEV_NOTICE })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^ scout $/ })).toBeDefined()
    await ui.unmount()
  })

  test('draws Jev again once the Panel is closed', ADVISED, async ($, on) => {
    const panes = [{ ...FLEET, isShown: true }]
    await start($, on, panes, ADVICE_ENV)
    const ui = await band($, 160)
    expect(await ui.find({ type: 'Text', text: JEV_LINE })).toBeUndefined()
    panes.length = 0
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: JEV_LINE })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: JEV_CI })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: JEV_NOTICE })).toBeDefined()
    await ui.unmount()
  })

  test('a Panel behind another tab keeps Jev in the strip', ADVISED, async ($, on) => {
    await start($, on, [{ ...FLEET, isShown: false }], ADVICE_ENV)
    const ui = await band($, 160)
    expect(await ui.find({ type: 'Text', text: JEV_LINE })).toBeDefined()
    await ui.unmount()
  })
})

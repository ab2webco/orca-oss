// Runs under `claude plugin test`: with the Panel shown the band drops its team scene for the progress line.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
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

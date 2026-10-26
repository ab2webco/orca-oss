// Runs under `claude plugin test`: the Panel's hero and the band's HUD hero wear the crown on a lead's pane only.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { HUD_KEY } from '../hooks/fleet-hud'
import { PANE_ID } from '../hooks/fleet-pane'
import { LEAD_GOLD } from '../hooks/hd-party'

const agent = (name: string, isLeader: boolean) => ({
  paneKey: `t:${name}`,
  displayName: name,
  agentType: 'claude',
  state: isLeader ? 'idle' : 'working',
  toolName: isLeader ? null : 'Edit',
  isLeader,
  ...(isLeader ? {} : { isMember: true, terminalHandle: `term_${name}` })
})

const stateOf = (role: 'lead' | 'member') => ({
  config: {},
  sources: {},
  warnings: [],
  worktree: { id: 'wt-1', path: '/w', branch: 'feat/game', displayName: 'game' },
  agents: [agent('lead', true), agent('builder', false)],
  review: null,
  workItem: null,
  links: [],
  role,
  actions: []
})

type Panes = readonly {
  id: string
  title: string
  isFocused: boolean
  isPlaced: boolean
  isShown: boolean
}[]

const start = async ($: Engine, on: On, role: 'lead' | 'member', panes: Panes, scene: string) => {
  const clock = mock.clock(on)
  mock.env(on, {
    ORCA_GAME_CLI: '/opt/orca/bin/orca',
    ORCA_GAME_LOCALE: 'en',
    ORCA_GAME_SCENE: scene,
    ORCA_GAME_RENDER: 'hd'
  })
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
      stdout: JSON.stringify(stateOf(role)),
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false
    }
  }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await clock.settle()
}

const panel = ($: Engine) =>
  $.ui.mount({
    plugin: 'orca-game',
    surface: 'terminal',
    component: 'Pane',
    requestId: PANE_ID,
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

const band = ($: Engine) =>
  $.ui.mount({
    plugin: 'orca-game',
    surface: 'terminal',
    component: 'AbovePrompt',
    viewport: { columns: 164, rows: 60, isFullscreen: true },
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows: 30,
      bodyColumns: 160,
      scroll: { offset: 0, bodyRows: 29 },
      view: {}
    }
  })

/** Whether a Raster's packed [codepoint, fg, bg] cells paint the crown's gold. */
const hasGold = (encoded: string): boolean => {
  const bytes = Uint8Array.from(atob(encoded), (one) => one.charCodeAt(0))
  const words = new Uint32Array(bytes.buffer, 0, Math.floor(bytes.length / 4))
  for (let i = 0; i + 2 < words.length; i += 3) {
    if (words[i] === 0x2580 && (words[i + 1] === LEAD_GOLD || words[i + 2] === LEAD_GOLD)) {
      return true
    }
  }
  return false
}

const FLEET = { id: PANE_ID, title: 'Fleet', isFocused: true, isPlaced: true }

// Why two keys: the Panel draws its HUD under its own key, the band under the shared one.
const PANEL_HUD_KEY = 'pane-hud'

const hudGoldOf = async (
  ui: Awaited<ReturnType<typeof panel>>,
  key: string
): Promise<boolean | undefined> => {
  const raster = await ui.find({ type: 'Raster', key })
  return raster === undefined ? undefined : hasGold(String(raster.props.cells ?? ''))
}

describe("the lead's crown on the HUD hero", () => {
  for (const scene of ['quest', 'vigilante']) {
    test(`${scene}: the Panel crowns the lead's hero`, async ($, on) => {
      await start($, on, 'lead', [{ ...FLEET, isShown: true }], scene)
      const ui = await panel($)
      expect(await hudGoldOf(ui, PANEL_HUD_KEY)).toBe(true)
      await ui.unmount()
    })

    test(`${scene}: the Panel draws no crown on a member's pane`, async ($, on) => {
      await start($, on, 'member', [{ ...FLEET, isShown: true }], scene)
      const ui = await panel($)
      expect(await hudGoldOf(ui, PANEL_HUD_KEY)).toBe(false)
      await ui.unmount()
    })

    test(`${scene}: the band's own HUD card follows the same rule`, async ($, on) => {
      await start($, on, 'lead', [], scene)
      const lead = await band($)
      expect(await hudGoldOf(lead, HUD_KEY)).toBe(true)
      await lead.unmount()
    })
  }
})

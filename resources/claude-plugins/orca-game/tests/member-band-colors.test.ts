// Runs under `claude plugin test`: a member's rows sit on the pane's own colors, not the scene panel.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'
import type { On } from 'claude-code'

import { QUEST_SCENE } from '../hooks/scenes/quest'

const PANEL = QUEST_SCENE.band.panel
const PARCHMENT = QUEST_SCENE.band.parchment

const ADVISOR = {
  version: 1,
  locale: 'en',
  line: 'jev · model: Opus 5.5 · effort high',
  model: 'Opus 5.5',
  modelId: 'claude-opus-5-5',
  effort: 'high',
  subagents: [],
  ci: [],
  notices: []
}

const JEV: Plugin = {
  name: 'orca-jev-mod-skills',
  register(on) {
    on('session.start', async ($, e, next) => {
      // Why the env: a test plugin runs on its own and cannot close over this file.
      const raw = await $.env.get('TEST_ADVISOR')
      if (raw) {
        await $.state.set({ plugin: 'orca-jev-mod-skills', key: 'advisor' }, JSON.parse(raw))
      }
      return next(e)
    })
  }
}

const STATE = {
  config: {},
  sources: {},
  warnings: [],
  worktree: { id: 'wt-757', path: '/w', branch: 'e2e-757', displayName: 'Arthur · E2E-757' },
  agents: [
    {
      paneKey: 't:self',
      displayName: 'Arthur · E2E-757',
      agentType: 'claude',
      state: 'working',
      toolName: null,
      isLeader: true
    }
  ],
  review: null,
  workItem: null,
  lead: { autostart: false, cap: 4 },
  role: 'member'
}

type Drawn = { props?: Record<string, unknown>; key?: unknown; children?: unknown }
const isDrawn = (one: unknown): one is Drawn => typeof one === 'object' && one !== null

/** Every value one prop takes anywhere in a drawn tree. */
const propsOf = (one: unknown, name: string): unknown[] => {
  if (!isDrawn(one)) {
    return []
  }
  const own = one.props && name in one.props ? [one.props[name]] : []
  const children = Array.isArray(one.children) ? one.children : []
  return [...own, ...children.flatMap((child) => propsOf(child, name))]
}

const mount = async ($: Engine, on: On, env: Record<string, string>, state: object) => {
  const clock = mock.clock(on)
  mock.env(on, {
    ORCA_GAME_CLI: '/opt/orca/bin/orca',
    ORCA_GAME_LOCALE: 'en',
    TEST_ADVISOR: JSON.stringify(ADVISOR),
    ...env
  })
  on('session.start', ($s, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.root', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 's1' }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: [] }) as never)
  on('ui.status', () => ({ value: undefined }))
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout: JSON.stringify(state),
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false
    }
  }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await clock.settle()
  return $.ui.mount({
    plugin: 'orca-game',
    surface: 'terminal',
    component: 'AbovePrompt',
    viewport: { columns: 124, rows: 40, isFullscreen: true },
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows: 8,
      scroll: { offset: 0, bodyRows: 7 },
      view: {},
      bodyColumns: 120
    }
  })
}

const WITH_JEV = { plugins: [JEV] }

describe('member band colors', () => {
  test("a member's own line paints no panel and leaves plain text to the pane", async ($, on) => {
    const ui = await mount($, on, { ORCA_GAME_ROLE: 'member' }, STATE)
    const self = await ui.find({ type: 'Box', key: 'band-member-self' })
    expect(self).toBeDefined()
    expect(propsOf(self, 'backgroundColor').filter((one) => one !== undefined)).toEqual([])
    expect(propsOf(self, 'color')).not.toContain(PARCHMENT)
    await ui.unmount()
  })

  test("a member's menu paints no panel either", async ($, on) => {
    const ui = await mount($, on, { ORCA_GAME_ROLE: 'member' }, STATE)
    const menu = await ui.find({ type: 'Box', key: 'band-member-menu' })
    expect(menu).toBeDefined()
    expect(propsOf(menu, 'backgroundColor').filter((one) => one !== undefined)).toEqual([])
    expect(propsOf(menu, 'color')).not.toContain(PARCHMENT)
    await ui.unmount()
  })

  test(
    "a member's strip of other plugins' lines paints no panel either",
    WITH_JEV,
    async ($, on) => {
      const ui = await mount($, on, { ORCA_GAME_ROLE: 'member' }, STATE)
      const strip = await ui.find({ type: 'Box', key: 'allies-strip' })
      expect(strip).toBeDefined()
      expect(propsOf(strip, 'backgroundColor')).not.toContain(PANEL)
      expect(propsOf(strip, 'color')).not.toContain(PARCHMENT)
      await ui.unmount()
    }
  )

  test("control: the lead's strip keeps the scene panel", WITH_JEV, async ($, on) => {
    const ui = await mount($, on, {}, { ...STATE, role: 'lead' })
    const strip = await ui.find({ type: 'Box', key: 'allies-strip' })
    expect(propsOf(strip, 'backgroundColor')).toContain(PANEL)
    await ui.unmount()
  })
})

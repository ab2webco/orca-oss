// Runs under `claude plugin test`: the band fits the pane at every width it is drawn at.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'
import type { On } from 'claude-code'

import { cellWidthOf } from '../hooks/cell-width'
import { HUD_KEY } from '../hooks/fleet-hud'
import { isTapLayout, TAP_LAYOUT_COLUMNS, TAP_ROWS } from '../hooks/tap-layout'

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 8,
    scroll: { offset: 0, bodyRows: 7 },
    view: {}
  }
} as const

const ADVISOR = {
  version: 1,
  locale: 'es',
  line: 'jev · 2 agentes trabajando en la rama feat/orca-586-game-agent-view',
  model: 'Opus 5.5',
  modelId: 'claude-opus-5-5',
  effort: 'high',
  subagents: [
    {
      id: 'a1',
      type: 'general-purpose',
      title: 'Write the strip that absorbs every other plugin status line',
      branch: 'feat/x',
      worktree: null,
      model: 'Sonnet 5',
      effort: 'medium',
      status: 'running',
      why: 'lowered',
      verdict: 'Jev baja'
    }
  ],
  ci: [],
  notices: []
}

const STATE = {
  config: {},
  sources: {},
  warnings: [],
  worktree: { id: 'wt-1', path: '/w', branch: 'feat/game', displayName: 'game' },
  agents: [
    {
      paneKey: 't:lead',
      displayName: 'lead',
      agentType: 'claude',
      state: 'working',
      toolName: 'Edit',
      isLeader: true
    },
    {
      paneKey: 't:builder',
      displayName: 'builder',
      agentType: 'claude',
      state: 'working',
      toolName: 'Edit',
      isLeader: false
    },
    {
      paneKey: 't:tester',
      displayName: 'tester',
      agentType: 'claude',
      state: 'idle',
      toolName: null,
      isLeader: false
    },
    {
      paneKey: 't:scribe',
      displayName: 'scribe',
      agentType: 'claude',
      state: 'waiting',
      toolName: null,
      isLeader: false
    }
  ],
  review: {
    provider: 'github',
    number: 901,
    title: 'feat: game',
    url: 'https://github.com/o/r/pull/901',
    state: 'open',
    ci: 'failure'
  },
  workItem: {
    provider: 'plane',
    identifier: 'ORCA-586',
    title: 'Game',
    url: 'https://plane.example/ORCA-586',
    status: 'In Progress',
    statusGroup: 'in_progress'
  },
  role: 'lead',
  actions: [
    ...['wave', 'status', 'push', 'sweep', 'stop'].map((command) => ({
      id: `lead:${command}`,
      label: command,
      command,
      prompt: `Run ${command}`
    })),
    { id: 'action-0', label: 'Test runs', command: 'runs', prompt: 'Run the QA test runs' }
  ]
}

// Why: agents and branches can be named in any script; wide text must fit in the en/es UI too.
const CJK_STATE = {
  ...STATE,
  worktree: { ...STATE.worktree, branch: 'feat/ゲーム画面', displayName: 'ゲーム' },
  agents: STATE.agents.map((agent, index) => ({
    ...agent,
    displayName: ['リーダー', '設計担当者', '検証担当者', '記録係'][index] ?? agent.displayName
  })),
  review: { ...STATE.review, title: '機能: ゲーム画面の追加' },
  workItem: { ...STATE.workItem, title: 'ゲーム画面' }
}

const CJK_ADVISOR = {
  ...ADVISOR,
  line: 'jev · 2 名のエージェントがブランチ feat/ゲーム画面 で作業中',
  subagents: ADVISOR.subagents.map((one) => ({
    ...one,
    title: '他のプラグインの状態行をまとめる帯を書く'
  }))
}

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
    on('session.start', async ($, e, next) => {
      $.ui.status(
        '◆ 3 rangers on patrol along the northern ridge, reporting back every ten minutes'
      )
      return next(e)
    })
  }
}

const engine = (on: On, env: Record<string, string>, state: object = STATE) => {
  mock.env(on, {
    ORCA_GAME_CLI: '/opt/orca/bin/orca',
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
}

type Drawn = { type?: unknown; key?: unknown; children?: unknown }
const isDrawn = (one: unknown): one is Drawn => typeof one === 'object' && one !== null

// What a terminal paints for a drawn element: its strings, depth first.
const shownOf = (one: unknown): string => {
  if (typeof one === 'string') {
    return one
  }
  return isDrawn(one) && Array.isArray(one.children) ? one.children.map(shownOf).join('') : ''
}

const elementsOf = (one: unknown): Drawn[] =>
  isDrawn(one) && Array.isArray(one.children) ? one.children.filter(isDrawn) : []

/** Cells a row of chips takes: each chip's text and one cell of gap between two. */
const rowWidthOf = (row: unknown): number =>
  cellWidthOf(shownOf(row)) + Math.max(0, elementsOf(row).length - 1)

const ALL = { plugins: [JEV, SCOUT] }
const WIDTHS = [32, 40, 50, 60, 80, 120, 160] as const

const mount = async (
  $: Engine,
  on: On,
  columns: number,
  env: Record<string, string> = {},
  state: object = STATE
) => {
  const clock = mock.clock(on)
  engine(on, env, state)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await clock.settle()
  return $.ui.mount({
    plugin: 'orca-game',
    surface: 'terminal',
    ...BAND,
    viewport: { columns: columns + 4, rows: 40, isFullscreen: true },
    props: { ...BAND.props, bodyColumns: columns }
  })
}

describe('band layout', () => {
  for (const columns of WIDTHS) {
    for (const [label, env, state] of [
      ['es', { ORCA_GAME_LOCALE: 'es' }, STATE],
      ['en', { ORCA_GAME_LOCALE: 'en' }, STATE],
      [
        'es with CJK names',
        { ORCA_GAME_LOCALE: 'es', TEST_ADVISOR: JSON.stringify(CJK_ADVISOR) },
        CJK_STATE
      ],
      [
        'en with CJK names',
        { ORCA_GAME_LOCALE: 'en', TEST_ADVISOR: JSON.stringify(CJK_ADVISOR) },
        CJK_STATE
      ]
    ] as const) {
      test(`every row fits ${columns} columns in ${label}`, ALL, async ($, on) => {
        const ui = await mount($, on, columns, env, state)
        const rows = (await ui.findAll({ type: 'Box' })).filter(
          (one) => one.key !== undefined && /^band-(chips|menu|actions)-/.test(one.key)
        )
        expect(rows.some((one) => one.key === 'band-chips-band-team')).toBe(true)
        expect(rows.filter((one) => one.key?.startsWith('band-chips-')).length).toBeLessThanOrEqual(
          2
        )
        if (isTapLayout(columns)) {
          // A phone draws the menu and the actions as one row of chips, each three rows tall.
          expect(rows.filter((one) => /^band-(menu|actions)-/.test(one.key ?? ''))).toEqual([])
          const tap = elementsOf(await ui.find({ type: 'Box', key: 'band-tap' }))
          expect(tap).toHaveLength(1)
          for (const row of rows) {
            expect(rowWidthOf(row)).toBeLessThanOrEqual(columns)
          }
          const chips = elementsOf(tap[0])
          const lines = chips.map((chip) => shownOf(chip).split('\n'))
          const width = lines.reduce((sum, chip) => sum + cellWidthOf(chip[1] ?? ''), 0)
          expect(width + chips.length - 1).toBeLessThanOrEqual(columns)
          for (const chip of lines) {
            expect(chip).toHaveLength(TAP_ROWS)
          }
        } else {
          expect(rows.filter((one) => one.key?.startsWith('band-actions-'))).toHaveLength(1)
          expect(rows.some((one) => one.key === 'band-menu-band-panel')).toBe(true)
          for (const row of rows) {
            expect(rowWidthOf(row)).toBeLessThanOrEqual(columns)
          }
        }
        const strip = await ui.find({ type: 'Box', key: 'allies-strip' })
        expect(elementsOf(strip).length).toBeGreaterThan(0)
        for (const row of elementsOf(strip)) {
          expect(cellWidthOf(shownOf(row))).toBeLessThanOrEqual(columns)
        }
        await ui.unmount()
      })
    }
  }

  test(
    'a narrow band draws the HUD as one fitted line instead of its frame',
    ALL,
    async ($, on) => {
      const ui = await mount($, on, 32)
      expect(await ui.find({ type: 'Raster', key: HUD_KEY })).toBeUndefined()
      const line = shownOf(await ui.find({ type: 'Box', key: 'band-hud-line' }))
      expect(line).toMatch(/^Lv 1 · × builder  × tester/)
      expect(cellWidthOf(line)).toBeLessThanOrEqual(32)
      await ui.unmount()
    }
  )

  test(
    'a wide band keeps the frame and every chip at full length on one row',
    ALL,
    async ($, on) => {
      const ui = await mount($, on, 160)
      expect(await ui.find({ type: 'Raster', key: HUD_KEY })).toBeDefined()
      expect(await ui.find({ type: 'Box', key: 'band-hud-line' })).toBeUndefined()
      const chipRows = (await ui.findAll({ type: 'Box' })).filter((one) =>
        one.key?.startsWith('band-chips-')
      )
      expect(chipRows).toHaveLength(1)
      const chips = shownOf(chipRows[0])
      expect(chips).toContain('Team 3 teammates')
      expect(chips).toContain('#901 open · CI failing')
      expect(chips).toContain('ORCA-586 In Progress')
      expect(shownOf(await ui.find({ type: 'Box', key: 'band-menu-band-panel' }))).toContain(
        '♥ Pet'
      )
      await ui.unmount()
    }
  )

  test(
    'at 40 columns the least important chips shorten and the menu leads the row of chips',
    ALL,
    async ($, on) => {
      const ui = await mount($, on, 40, { ORCA_GAME_LOCALE: 'es' })
      const [row] = elementsOf(await ui.find({ type: 'Box', key: 'band-tap' }))
      const labels = elementsOf(row).map((chip) => shownOf(chip).split('\n')[1]?.trim())
      expect(labels.slice(0, 3)).toEqual(['▤ Panel', '↻', '♥'])
      const chips = shownOf(await ui.find({ type: 'Box', key: 'band-chips-band-team' }))
      expect(chips).toContain('⚑')
      await ui.unmount()
    }
  )

  test(`at ${TAP_LAYOUT_COLUMNS} columns the menu keeps one row`, ALL, async ($, on) => {
    const ui = await mount($, on, TAP_LAYOUT_COLUMNS, { ORCA_GAME_LOCALE: 'es' })
    const menuRows = (await ui.findAll({ type: 'Box' })).filter((one) =>
      one.key?.startsWith('band-menu-')
    )
    expect(menuRows.map((one) => one.key)).toEqual(['band-menu-band-panel'])
    await ui.unmount()
  })

  test('zen keeps the same fitted rows', ALL, async ($, on) => {
    const ui = await mount($, on, 32, { ORCA_GAME_MODE: 'zen' })
    const strip = await ui.find({ type: 'Box', key: 'allies-strip' })
    expect(elementsOf(strip)).toHaveLength(1)
    expect(cellWidthOf(shownOf(elementsOf(strip)[0]))).toBeLessThanOrEqual(32)
    await ui.unmount()
  })
})

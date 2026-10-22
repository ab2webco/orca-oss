// Runs under `claude plugin test`: on a phone-width body every action is a compact chip, three rows tall.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { cellWidthOf } from '../hooks/cell-width'
import { HOTKEY_CELLS, TAP_LAYOUT_COLUMNS, TAP_MIN_CELLS, TAP_ROWS } from '../hooks/tap-layout'

const agent = (name: string, isLeader: boolean, handle?: string) => ({
  paneKey: `t:${name}`,
  displayName: name,
  agentType: 'claude',
  state: isLeader ? 'idle' : 'working',
  toolName: isLeader ? null : 'Edit',
  isLeader,
  ...(handle === undefined ? {} : { isMember: true, terminalHandle: handle })
})

const STATE = {
  config: {},
  sources: {},
  warnings: [],
  worktree: { id: 'wt-1', path: '/w', branch: 'feat/game', displayName: 'game' },
  agents: [
    agent('lead', true),
    agent('builder', false, 'term_b'),
    agent('tester', false, 'term_t')
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
    identifier: 'ORCA-606',
    title: 'Game',
    url: 'https://plane.example/ORCA-606',
    status: 'In Progress',
    statusGroup: 'in_progress'
  },
  links: [],
  role: 'lead',
  actions: [
    ...['wave', 'status', 'stop'].map((command) => ({
      id: `lead:${command}`,
      label: command,
      command,
      prompt: `Run ${command}`
    })),
    { id: 'action-0', label: 'Test runs', command: 'runs', prompt: 'Run the QA test runs' }
  ]
}

const engine = (on: On, state: object) => {
  mock.env(on, { ORCA_GAME_CLI: '/opt/orca/bin/orca', ORCA_GAME_LOCALE: 'en' })
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

type Drawn = { type?: unknown; key?: unknown; props?: Record<string, unknown>; children?: unknown }
const isDrawn = (one: unknown): one is Drawn => typeof one === 'object' && one !== null

const shownOf = (one: unknown): string => {
  if (typeof one === 'string') {
    return one
  }
  return isDrawn(one) && Array.isArray(one.children) ? one.children.map(shownOf).join('') : ''
}

const start = async ($: Engine, on: On, state: object = STATE) => {
  const clock = mock.clock(on)
  engine(on, state)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await clock.settle()
}

const band = ($: Engine, columns: number) =>
  $.ui.mount({
    plugin: 'orca-game',
    surface: 'terminal',
    component: 'AbovePrompt',
    viewport: { columns: columns + 5, rows: 60, isFullscreen: true },
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows: 30,
      bodyColumns: columns,
      scroll: { offset: 0, bodyRows: 29 },
      view: {}
    }
  })

const pane = ($: Engine, columns: number) =>
  $.ui.mount({
    plugin: 'orca-game',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'orca-game-fleet',
    viewport: { columns: columns + 4, rows: 120, isFullscreen: true },
    props: {
      title: 'Fleet',
      isFocused: true,
      bodyColumns: columns,
      placement: 'inline',
      scroll: { offset: 0, bodyRows: 110 },
      view: {}
    }
  })

type Mounted = Pick<Awaited<ReturnType<typeof band>>, 'find' | 'findAll'>

const childrenOf = (one: unknown): Drawn[] =>
  isDrawn(one) && Array.isArray(one.children) ? one.children.filter(isDrawn) : []

// A child as drawn carries its key in its props, a found element on itself too.
const keyOf = (one: Drawn | undefined): string => String(one?.key ?? one?.props?.key)

/**
 * A tap group's rows of chips: each chip three rows as wide as its label (row one less its
 * hotkey), at least six cells, and each row within the body.
 */
const expectTapGroup = async (
  ui: Mounted,
  key: string,
  columns: number,
  buttons: string[],
  maxRows = Number.MAX_SAFE_INTEGER
): Promise<Drawn[][]> => {
  const group = await ui.find({ type: 'Box', key })
  expect(group, key).toBeDefined()
  // A blank row between two rows of chips, and above the group so two groups in a row keep one too.
  expect(group?.props).toMatchObject({ flexDirection: 'column', rowGap: 1, marginTop: 1 })
  const rows = childrenOf(group).map(childrenOf)
  expect(rows.length, key).toBeLessThanOrEqual(maxRows)
  expect(rows.flat().map(keyOf).sort()).toEqual([...buttons].sort())
  for (const row of rows) {
    let width = Math.max(0, row.length - 1)
    for (const button of row) {
      const prefix = button.props?.hotkey === undefined ? 0 : HOTKEY_CELLS
      const lines = shownOf(button).split('\n')
      expect(lines, keyOf(button)).toHaveLength(TAP_ROWS)
      const chip = cellWidthOf(lines[1] ?? '')
      expect(lines.map(cellWidthOf), keyOf(button)).toEqual([chip - prefix, chip, chip])
      expect(chip, keyOf(button)).toBeGreaterThanOrEqual(TAP_MIN_CELLS)
      // Compact: the label and its padding, never the body's width.
      expect(chip, keyOf(button)).toBeLessThanOrEqual(
        Math.max(TAP_MIN_CELLS, cellWidthOf(lines[1]?.trim() ?? '') + 2)
      )
      width += chip
    }
    expect(width, key).toBeLessThanOrEqual(columns)
  }
  return rows
}

const tapGroupsOf = async (ui: Mounted) =>
  (await ui.findAll({ type: 'Box' })).filter((one) => String(one.key).endsWith('-tap'))

const BAND_MENU = ['band-panel', 'band-refresh', 'band-flat']

describe('the band on a phone', () => {
  for (const columns of [36, 45, TAP_LAYOUT_COLUMNS - 1]) {
    test(`at ${columns} columns the menu and the actions share one row of chips`, async ($, on) => {
      await start($, on)
      const ui = await band($, columns)
      const keys = (await ui.findAll({ type: 'Button' }))
        .map((one) => String(one.key))
        .filter((one) => one.startsWith('band-action') || BAND_MENU.includes(one))
      const [row] = await expectTapGroup(ui, 'band-tap', columns, keys, 1)
      const shown = (row ?? []).map(keyOf)
      expect(shown.slice(0, 3)).toEqual(BAND_MENU)
      const actions = shown.filter((one) => one.startsWith('band-action-'))
      const more = (row ?? []).find((one) => keyOf(one) === 'band-actions-more')
      // Every action is a chip or counted in the +N, which opens the Panel's full row.
      expect(actions.length + Number(shownOf(more).trim().replace('+', '') || 0)).toBe(4)
      expect(await tapGroupsOf(ui)).toHaveLength(1)
      await ui.unmount()
    })
  }

  test('two actions that fit both stay, with no +N', async ($, on) => {
    await start($, on, { ...STATE, actions: STATE.actions.slice(0, 2) })
    const ui = await band($, TAP_LAYOUT_COLUMNS - 1)
    await expectTapGroup(
      ui,
      'band-tap',
      TAP_LAYOUT_COLUMNS - 1,
      [...BAND_MENU, 'band-action-lead:wave', 'band-action-lead:status'],
      1
    )
    await ui.unmount()
  })

  for (const columns of [TAP_LAYOUT_COLUMNS, 160]) {
    test(`at ${columns} columns the band keeps its one-row chips`, async ($, on) => {
      await start($, on)
      const ui = await band($, columns)
      expect(await tapGroupsOf(ui)).toEqual([])
      const menu = await ui.find({ type: 'Box', key: 'band-menu-band-panel' })
      expect(shownOf(menu)).not.toContain('\n')
      expect(
        await ui.find({ type: 'Box', key: 'band-actions-band-action-lead:wave' })
      ).toBeDefined()
      await ui.unmount()
    })
  }
})

describe('the Fleet pane on a phone', () => {
  test('at 41 columns Close, the menu, View, the links and the actions are chips', async ($, on) => {
    await start($, on)
    const ui = await pane($, 41)
    const [menu] = await expectTapGroup(
      ui,
      'pane-menu-tap',
      41,
      ['refresh', 'flat', 'pet', 'quit'],
      1
    )
    // Close leads: a phone shows the pane's top rows, and Close is how it leaves.
    expect(keyOf(menu?.[0])).toBe('quit')
    await expectTapGroup(ui, 'view-tap-t:builder', 41, ['view-t:builder'], 1)
    await expectTapGroup(ui, 'view-tap-t:tester', 41, ['view-t:tester'], 1)
    await expectTapGroup(ui, 'pane-links-tap', 41, ['open-work-item', 'open-review'])
    await expectTapGroup(ui, 'project-actions-tap', 41, [
      'action-lead:wave',
      'action-lead:status',
      'action-lead:stop',
      'action-action-0'
    ])
    expect(await ui.find({ type: 'Button', key: 'view-t:builder' })).toMatchObject({
      props: { hotkey: '2' }
    })
    expect(shownOf(await ui.find({ type: 'Button', key: 'quit' }))).toContain('✕ Close')
    const drawn = (await ui.findAll({ type: 'Box' }))
      .map(shownOf)
      .reduce((all, one) => (one.length > all.length ? one : all), '')
    expect(drawn.indexOf('✕ Close')).toBeGreaterThan(-1)
    expect(drawn.indexOf('✕ Close')).toBeLessThan(drawn.indexOf('2 working'))
    await ui.unmount()
  })

  for (const columns of [36, 41, 50]) {
    test(`at ${columns} columns the Fleet counts are one row of one-line chips`, async ($, on) => {
      await start($, on)
      const ui = await pane($, columns)
      const group = await ui.find({ type: 'Box', key: 'pane-fleet-chips' })
      // A blank row above, or the counts read as one more row of the menu chips over them.
      expect(group?.props).toMatchObject({ marginTop: 1 })
      const rows = childrenOf(group).map(childrenOf)
      expect(rows).toHaveLength(1)
      const chips = rows[0] ?? []
      const labels = chips.map(shownOf)
      // A drawn Text keeps no key: each chip is its full label or the band's mark for it.
      const expected = [/^⚑/, /^(2 working|• 2)$/, /^(0 idle|z 0)$/, /^(0 waiting on you|! 0)$/]
      expect(labels).toHaveLength(expected.length)
      labels.forEach((label, at) => expect(label.trim()).toMatch(expected[at] ?? /^$/))
      for (const label of labels) {
        expect(label).not.toContain('\n')
      }
      const width = labels.reduce((all, one) => all + cellWidthOf(one), chips.length - 1)
      expect(width).toBeLessThanOrEqual(columns)
      await ui.unmount()
    })
  }

  test('at 84 columns, a docked pane, every button keeps its one-row chip', async ($, on) => {
    await start($, on)
    const ui = await pane($, 84)
    expect(await tapGroupsOf(ui)).toEqual([])
    expect(await ui.find({ type: 'Box', key: 'pane-fleet-chips' })).toBeUndefined()
    for (const key of ['quit', 'view-t:builder', 'open-work-item', 'action-action-0']) {
      expect(shownOf(await ui.find({ type: 'Button', key })), key).not.toContain('\n')
    }
    await ui.unmount()
  })
})

// Runs under `claude plugin test`: on a phone-width body every action is a full-width, two-row button.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { cellWidthOf } from '../hooks/cell-width'
import { HOTKEY_CELLS, TAP_LAYOUT_COLUMNS, TAP_ROWS } from '../hooks/tap-layout'

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

type Mounted = Awaited<ReturnType<typeof band>>

/** Each button of a tap group: two rows, each as wide as the body less its hotkey. */
const expectTapGroup = async (ui: Mounted, key: string, columns: number, buttons: string[]) => {
  const group = await ui.find({ type: 'Box', key })
  expect(group, key).toBeDefined()
  // A blank row between two buttons, and above the group so two groups in a row keep one too.
  expect(group?.props).toMatchObject({ flexDirection: 'column', rowGap: 1, marginTop: 1 })
  const drawn = (await ui.findAll({ type: 'Button' })).filter((one) =>
    buttons.includes(String(one.key))
  )
  expect(drawn.map((one) => one.key).sort()).toEqual([...buttons].sort())
  for (const button of drawn) {
    // A hotkey's `q: ` takes the first row's start; the second row starts at the left edge.
    const room = columns - (button.props?.hotkey === undefined ? 0 : HOTKEY_CELLS)
    const lines = shownOf(button).split('\n')
    expect(lines, String(button.key)).toHaveLength(TAP_ROWS)
    expect(lines.map(cellWidthOf), String(button.key)).toEqual([room, columns])
  }
}

const tapGroupsOf = async (ui: Mounted) =>
  (await ui.findAll({ type: 'Box' })).filter((one) => String(one.key).endsWith('-tap'))

describe('the band on a phone', () => {
  for (const columns of [40, TAP_LAYOUT_COLUMNS - 1]) {
    test(`at ${columns} columns the menu and the actions are tap buttons`, async ($, on) => {
      await start($, on)
      const ui = await band($, columns)
      await expectTapGroup(ui, 'band-menu-tap', columns, ['band-panel', 'band-refresh', 'band-pet'])
      await expectTapGroup(ui, 'band-actions-tap', columns, [
        'band-action-lead:wave',
        'band-actions-more'
      ])
      expect(shownOf(await ui.find({ type: 'Button', key: 'band-actions-more' }))).toContain(
        '+3 more'
      )
      // Why the menu first: a short phone scrolls the band, and Panel is what reaches the rest.
      const groups = (await tapGroupsOf(ui)).map((one) => one.key)
      expect(groups).toEqual(['band-menu-tap', 'band-actions-tap'])
      await ui.unmount()
    })
  }

  test('two actions both stay, with no +N', async ($, on) => {
    await start($, on, { ...STATE, actions: STATE.actions.slice(0, 2) })
    const ui = await band($, 40)
    await expectTapGroup(ui, 'band-actions-tap', 40, [
      'band-action-lead:wave',
      'band-action-lead:status'
    ])
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
  test('at 41 columns Close, the menu, View, the links and the actions are tap buttons', async ($, on) => {
    await start($, on)
    const ui = await pane($, 41)
    await expectTapGroup(ui, 'pane-menu-tap', 41, ['refresh', 'pet', 'quit'])
    await expectTapGroup(ui, 'view-tap-t:builder', 41, ['view-t:builder'])
    await expectTapGroup(ui, 'view-tap-t:tester', 41, ['view-t:tester'])
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
    await ui.unmount()
  })

  test('at 84 columns, a docked pane, every button keeps its one-row chip', async ($, on) => {
    await start($, on)
    const ui = await pane($, 84)
    expect(await tapGroupsOf(ui)).toEqual([])
    for (const key of ['quit', 'view-t:builder', 'open-work-item', 'action-action-0']) {
      expect(shownOf(await ui.find({ type: 'Button', key })), key).not.toContain('\n')
    }
    await ui.unmount()
  })
})

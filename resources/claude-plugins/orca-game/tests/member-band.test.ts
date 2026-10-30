// Runs under `claude plugin test`: a member's pane draws its own compact band, not the lead's.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { cellWidthOf } from '../hooks/cell-width'
import { SCENE_KEY } from '../hooks/scene'

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

const MEMBER_STATE = {
  config: {},
  sources: {},
  warnings: [],
  worktree: { id: 'wt-757', path: '/w', branch: 'fabolivark/orca-757', displayName: 'orca-757' },
  agents: [
    {
      paneKey: 't:self',
      displayName: 'Rex · ORCA-757 Member panes look like part of the game',
      agentType: 'claude',
      state: 'working',
      toolName: 'Edit',
      isLeader: true
    }
  ],
  review: {
    provider: 'github',
    number: 607,
    title: 'feat(game): member band',
    url: 'https://github.com/o/r/pull/607',
    state: 'open',
    ci: 'failure'
  },
  workItem: {
    provider: 'plane',
    identifier: 'ORCA-757',
    title: 'Member panes look like part of the game',
    url: 'https://plane.example/ORCA-757',
    status: 'In Progress',
    statusGroup: 'in_progress'
  },
  lead: { autostart: false, cap: 4, label: 'Orca' },
  role: 'member',
  actions: [{ id: 'action-0', label: 'Test runs', command: 'runs', prompt: 'Run the QA runs' }]
}

const LEAD_STATE = { ...MEMBER_STATE, role: 'lead' }

type Drawn = { type?: unknown; key?: unknown; children?: unknown }
const isDrawn = (one: unknown): one is Drawn => typeof one === 'object' && one !== null

const shownOf = (one: unknown): string => {
  if (typeof one === 'string') {
    return one
  }
  return isDrawn(one) && Array.isArray(one.children) ? one.children.map(shownOf).join('') : ''
}

const engine = (
  on: On,
  env: Record<string, string>,
  state: object,
  toolCall: () => Promise<unknown> = async () => ({ result: { stdout: '' }, text: '' })
) => {
  mock.env(on, { ORCA_GAME_CLI: '/opt/orca/bin/orca', ORCA_GAME_LOCALE: 'en', ...env })
  on('session.start', ($s, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.root', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 's1' }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: [] }) as never)
  on('ui.status', () => ({ value: undefined }))
  on('command.run', () => ({ text: '' }) as never)
  on('tool.call', () => toolCall() as never)
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

const mount = async (
  $: Engine,
  on: On,
  args: {
    columns: number
    env?: Record<string, string>
    state?: object
    toolCall?: () => Promise<unknown>
  }
) => {
  const clock = mock.clock(on)
  engine(on, args.env ?? {}, args.state ?? MEMBER_STATE, args.toolCall)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await clock.settle()
  const ui = await $.ui.mount({
    plugin: 'orca-game',
    surface: 'terminal',
    ...BAND,
    viewport: { columns: args.columns + 4, rows: 40, isFullscreen: true },
    props: { ...BAND.props, bodyColumns: args.columns }
  })
  return { ui, clock }
}

const spinnerOf = ($: Engine) =>
  $.ui.mount({
    plugin: 'orca-game',
    surface: 'terminal',
    component: 'Spinner',
    viewport: { columns: 124, rows: 40, isFullscreen: true },
    props: { word: 'Working', message: null, suffix: '', mode: 'thinking' }
  })

const leadRowsOf = async (ui: Awaited<ReturnType<typeof mount>>['ui']) =>
  (await ui.findAll({ type: 'Box' })).filter(
    (one) => one.key !== undefined && /^band-(chips|menu|actions|tap|hud)/.test(one.key)
  )

describe('member band', () => {
  test('a member pane draws its own character, ticket, PR and CI', async ($, on) => {
    const { ui } = await mount($, on, { columns: 120, env: { ORCA_GAME_ROLE: 'member' } })
    const line = shownOf(await ui.find({ type: 'Box', key: 'band-member-self' }))
    expect(line).toContain('Rex')
    expect(line).toContain('ORCA-757')
    expect(line).toContain('PR #607')
    expect(line).toContain('CI failing')
    await ui.unmount()
  })

  test('a member pane draws no lead buttons, team chips or party HUD', async ($, on) => {
    const { ui } = await mount($, on, { columns: 120, env: { ORCA_GAME_ROLE: 'member' } })
    expect(await leadRowsOf(ui)).toEqual([])
    await ui.unmount()
  })

  test("a pane Orca's state calls a member draws its band without the env", async ($, on) => {
    const { ui } = await mount($, on, { columns: 120 })
    expect(await ui.find({ type: 'Box', key: 'band-member-self' })).toBeDefined()
    expect(await leadRowsOf(ui)).toEqual([])
    await ui.unmount()
  })

  test('a member launched as one draws its band before the first state arrives', async ($, on) => {
    const { ui } = await mount($, on, {
      columns: 120,
      env: { ORCA_GAME_ROLE: 'member' },
      state: { not: 'a state' }
    })
    expect(await ui.find({ type: 'Box', key: 'band-member-self' })).toBeDefined()
    expect(await leadRowsOf(ui)).toEqual([])
    await ui.unmount()
  })

  for (const columns of [24, 32, 40, 60, 80, 160]) {
    test(`the member band fits ${columns} columns`, async ($, on) => {
      const { ui } = await mount($, on, { columns, env: { ORCA_GAME_ROLE: 'member' } })
      const rows = (await ui.findAll({ type: 'Box' })).filter((one) =>
        one.key?.startsWith('band-member-')
      )
      expect(rows.length).toBeGreaterThan(0)
      for (const row of rows) {
        expect(cellWidthOf(shownOf(row))).toBeLessThanOrEqual(columns)
      }
      await ui.unmount()
    })
  }

  test('while the member waits on its lead the band shows the question', async ($, on) => {
    let answer: (value: unknown) => void = () => undefined
    const asked = new Promise((resolve) => {
      answer = resolve
    })
    const { ui, clock } = await mount($, on, {
      columns: 120,
      env: { ORCA_GAME_ROLE: 'member' },
      toolCall: () => asked
    })
    const call = $.tool.call({
      tool: 'Bash',
      command:
        'orca orchestration ask --from term_a --dispatch-capability dcap_x --question "Merge #607 now or wait for #606?" --timeout-ms 600000'
    } as never)
    await clock.settle()
    const shown = shownOf(await ui.find({ type: 'Box', key: 'band-member-question' }))
    expect(shown).toContain('Orca')
    expect(shown).toContain('Merge #607 now or wait for #606?')
    answer({ result: { stdout: 'wait' }, text: 'wait' })
    await call
    await clock.settle()
    expect(await ui.find({ type: 'Box', key: 'band-member-question' })).toBeUndefined()
    await ui.unmount()
  })

  test('a member collapses its band to the menu, and its turn draws no scene banner', async ($, on) => {
    const { ui } = await mount($, on, { columns: 120, env: { ORCA_GAME_ROLE: 'member' } })
    const turn = await spinnerOf($)
    expect(await turn.find({ type: 'Raster', key: SCENE_KEY })).toBeDefined()
    await turn.unmount()

    await ui.press({ key: 'band-member-collapse' })
    await ui.redraw()
    expect(await ui.find({ type: 'Box', key: 'band-member-self' })).toBeUndefined()
    expect(await ui.find({ type: 'Box', key: 'band-member-menu' })).toBeDefined()
    const collapsed = await spinnerOf($)
    expect(await collapsed.findAll({ type: 'Raster' })).toEqual([])
    expect(await collapsed.find({ type: 'Box', key: 'flat-phase' })).toBeUndefined()
    await collapsed.unmount()

    await ui.press({ key: 'band-member-collapse' })
    await ui.redraw()
    expect(await ui.find({ type: 'Box', key: 'band-member-self' })).toBeDefined()
    await ui.unmount()
  })

  test("a member's menu speaks the pane's language", async ($, on) => {
    const { ui } = await mount($, on, {
      columns: 120,
      env: { ORCA_GAME_ROLE: 'member', ORCA_GAME_LOCALE: 'es' }
    })
    const menu = shownOf(await ui.find({ type: 'Box', key: 'band-member-menu' }))
    expect(menu).toContain('Plegar')
    expect(menu).toContain('Texto')
    expect(menu).toContain('Actualizar')
    await ui.unmount()
  })

  test('a member band toggles text mode, so its turn draws a text line', async ($, on) => {
    const { ui } = await mount($, on, { columns: 120, env: { ORCA_GAME_ROLE: 'member' } })
    await ui.press({ key: 'band-member-flat' })
    await ui.redraw()
    const turn = await spinnerOf($)
    expect(await turn.findAll({ type: 'Raster' })).toEqual([])
    expect(await turn.find({ type: 'Box', key: 'flat-phase' })).toBeDefined()
    await turn.unmount()
    expect(await ui.find({ type: 'Box', key: 'band-member-self' })).toBeDefined()
    await ui.unmount()
  })

  test('control: the lead pane keeps its menu and team chips', async ($, on) => {
    const { ui } = await mount($, on, { columns: 120, state: LEAD_STATE })
    expect(await ui.find({ type: 'Box', key: 'band-member-self' })).toBeUndefined()
    expect((await leadRowsOf(ui)).length).toBeGreaterThan(0)
    await ui.unmount()
  })
})

// Runs under `claude plugin test`: the Panel's sections collapse, and the layout comes back from `$.store`.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { SCENE_TICK_MS } from '../hooks/scene'

const ORCA_CLI = '/opt/orca/bin/orca'
const LAYOUT_KEY = 'panel-layout'

const agent = (name: string, state: string, isLeader = false) => ({
  paneKey: `tab-1:${name}`,
  displayName: name,
  agentType: 'claude',
  state,
  toolName: null,
  isLeader
})

const item = (id: string, group: string) => ({
  id,
  title: `Ticket ${id}`,
  url: `https://plane.example/${id}`,
  group
})

const STATE = {
  config: {},
  sources: {},
  warnings: [],
  worktree: { id: 'repo-1::/w', path: '/w', branch: 'feat/game', displayName: 'game' },
  agents: [agent('lead', 'working', true), agent('builder', 'working'), agent('tester', 'idle')],
  review: {
    provider: 'github',
    number: 42,
    title: 'feat: game',
    url: 'https://github.com/o/r/pull/42',
    state: 'open',
    ci: 'failure'
  },
  workItem: null,
  links: [],
  activity: null,
  extensions: { scenes: [] },
  project: {
    reviews: null,
    todo: {
      provider: 'plane',
      total: 12,
      url: 'https://plane.example/todo',
      items: [item('ORCA-1', 'todo'), item('ORCA-2', 'todo')],
      groups: { todo: 12 }
    }
  }
}

type World = { store: Map<string, unknown>; writes: [string, unknown][]; toasts: string[] }

const worldOf = (seeded?: unknown): World => ({
  store: new Map(seeded === undefined ? [] : [[LAYOUT_KEY, seeded]]),
  writes: [],
  toasts: []
})

const DEFAULT_ORDER = ['team', 'review', 'reviews', 'todo', 'actions', 'metrics']

// A version 2 layout for the project; the fields given replace the default ones.
const fleetStore = (fleet: Record<string, unknown>) => ({
  version: 2,
  projects: {
    'repo-1': {
      fleet: { order: DEFAULT_ORDER, collapsed: [], shown: ['team', 'reviews'], ...fleet }
    }
  }
})

// What the host sends the lead: three days of merges, the median lead time and one account.
const METRICS = {
  computedAt: '2026-10-30T18:00:00.000Z',
  timezone: 'America/Bogota',
  mergedPerDay: [
    { day: '2026-10-28', merged: 0 },
    { day: '2026-10-29', merged: 2 },
    { day: '2026-10-30', merged: 4 }
  ],
  leadTime: { medianMs: 26 * 3_600_000, measured: 6 },
  claudeAccounts: [
    { email: 'lead@example.com', active: true, sessionPercent: 41, weeklyPercent: 92 }
  ]
}

const engine = (on: On, world: World, locale: string, state: unknown) => {
  mock.env(on, { ORCA_GAME_CLI: ORCA_CLI, ORCA_GAME_LOCALE: locale })
  on('session.start', ($s, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.root', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 's1' }))
  on('store.get', ($s, e) => ({ value: world.store.get(e.key) }))
  on('store.set', ($s, e) => {
    world.store.set(e.key, e.value)
    world.writes.push([e.key, e.value])
    return { value: undefined }
  })
  on('ui.toast', ($s, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: [] }) as never)
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
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
const shownOf = (one: unknown): string => {
  if (typeof one === 'string') {
    return one
  }
  return isDrawn(one) && Array.isArray(one.children) ? one.children.map(shownOf).join('') : ''
}

const start = async ($: Engine, on: On, world: World, locale = 'en', state: unknown = STATE) => {
  const clock = mock.clock(on)
  engine(on, world, locale, state)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await clock.settle()
  return clock
}

const pane = ($: Engine, columns = 120) =>
  $.ui.mount({
    plugin: 'orca-game',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'orca-game-fleet',
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

type Mounted = Awaited<ReturnType<typeof pane>>

/** How many member-tile frames the Panel sends over 30 animation ticks. */
const tileBlitsOf = async ($: Engine, on: On, world: World) => {
  const blits: string[] = []
  on('ui.blit', ($s, e) => {
    blits.push(e.key)
    return { value: {} }
  })
  const clock = await start($, on, world)
  const ui = await pane($)
  blits.length = 0
  await clock.advance(SCENE_TICK_MS * 30)
  await ui.unmount()
  return blits.filter((key) => key.startsWith('tile-')).length
}

const headerOf = async (ui: Mounted, section: string) =>
  shownOf(await ui.find({ type: 'Box', key: `layout-header-${section}` }))
const cardsOf = async (ui: Mounted) =>
  (await ui.findAll({ type: 'Box' })).filter((one) => one.key?.startsWith('card-tab-1:'))

describe('panel layout', () => {
  test('an untouched layout draws Team, leaves To Do off the Panel and stores nothing', async ($, on) => {
    const world = worldOf()
    await start($, on, world)
    const ui = await pane($)
    expect(await headerOf(ui, 'team')).toBe('▾ Team 3')
    expect((await cardsOf(ui)).length).toBe(3)
    expect(await ui.find({ type: 'Box', key: 'layout-header-todo' })).toBeUndefined()
    expect(await ui.find({ type: 'Box', key: 'project-todo' })).toBeUndefined()
    expect(world.writes).toEqual([])
    await ui.unmount()
  })

  test('pressing a section header collapses it to one line and stores it for the project', async ($, on) => {
    const world = worldOf(fleetStore({ shown: ['team', 'reviews', 'todo'] }))
    await start($, on, world)
    const ui = await pane($)
    await ui.press({ key: 'layout-toggle-todo' })
    expect(await headerOf(ui, 'todo')).toBe('▸ To Do 12')
    expect(shownOf(await ui.find({ type: 'Box', key: 'project-todo' }))).not.toContain('ORCA-1')
    expect(world.writes).toEqual([
      [LAYOUT_KEY, fleetStore({ collapsed: ['todo'], shown: ['team', 'reviews', 'todo'] })]
    ])
    await ui.press({ key: 'layout-toggle-team' })
    expect(await headerOf(ui, 'team')).toBe('▸ Team 3')
    expect(await cardsOf(ui)).toEqual([])
    await ui.press({ key: 'layout-toggle-todo' })
    expect(await headerOf(ui, 'todo')).toBe('▾ To Do 12')
    await ui.unmount()
  })

  test('a stored layout comes back: collapsed, catalog and moved sections', async ($, on) => {
    const world = worldOf(
      fleetStore({ order: ['todo', 'team'], collapsed: ['team'], shown: ['todo', 'team'] })
    )
    await start($, on, world)
    const ui = await pane($)
    expect(await headerOf(ui, 'team')).toBe('▸ Team 3')
    expect(await cardsOf(ui)).toEqual([])
    expect(await ui.find({ type: 'Box', key: 'layout-header-review' })).toBeUndefined()
    const keys = (await ui.findAll({ type: 'Box' }))
      .map((one) => one.key)
      .filter((key) => key === 'layout-header-todo' || key === 'layout-header-team')
    expect(keys).toEqual(['layout-header-todo', 'layout-header-team'])
    await ui.unmount()
  })

  test('on a phone each section toggles from a touch-sized chip', async ($, on) => {
    const world = worldOf(fleetStore({ shown: ['team', 'reviews', 'todo'] }))
    await start($, on, world)
    const ui = await pane($, 40)
    const chip = await ui.find({ type: 'Button', key: 'layout-tap-todo' })
    expect(shownOf(chip)).toContain('▾ To Do')
    // A tap chip is three rows tall: its label sits between two padding rows.
    expect(shownOf(chip).split('\n')).toHaveLength(3)
    await ui.press({ key: 'layout-tap-todo' })
    expect(await headerOf(ui, 'todo')).toBe('▸ To Do 12')
    expect(shownOf(await ui.find({ type: 'Button', key: 'layout-tap-todo' }))).toContain('▸ To Do')
    await ui.unmount()
  })

  test('a collapsed review still says CI is failing', async ($, on) => {
    const world = worldOf(fleetStore({ collapsed: ['review'], shown: ['review'] }))
    await start($, on, world)
    const ui = await pane($)
    expect(await headerOf(ui, 'review')).toBe('▸ Review #42 open · CI failing')
    await ui.unmount()
  })

  test('a damaged or newer-build layout draws the default and is never overwritten', async ($, on) => {
    const newer = { version: 9, projects: { 'repo-1': { fleet: 'future' } } }
    const world = worldOf(newer)
    await start($, on, world)
    const ui = await pane($)
    expect(await headerOf(ui, 'team')).toBe('▾ Team 3')
    await ui.press({ key: 'layout-toggle-team' })
    expect(world.writes).toEqual([])
    expect(world.toasts.at(-1)).toContain('newer')
    await ui.unmount()
  })

  test('a closed Team widget animates no member tile', async ($, on) => {
    expect(await tileBlitsOf($, on, worldOf(fleetStore({ shown: ['reviews'] })))).toBe(0)
  })

  test('an open Team widget animates its member tiles', async ($, on) => {
    expect(await tileBlitsOf($, on, worldOf())).toBeGreaterThan(0)
  })

  test('a version 1 layout keeps every section it drew and stores nothing until changed', async ($, on) => {
    const world = worldOf({
      version: 1,
      projects: { 'repo-1': { fleet: { order: DEFAULT_ORDER, collapsed: [], hidden: ['review'] } } }
    })
    await start($, on, world)
    const ui = await pane($)
    expect(await headerOf(ui, 'todo')).toBe('▾ To Do 12')
    expect(await ui.find({ type: 'Box', key: 'layout-header-review' })).toBeUndefined()
    expect(world.writes).toEqual([])
    await ui.unmount()
  })

  test('a widget added from the Panel menu shows at once and is still there after a reopen', async ($, on) => {
    const world = worldOf()
    await start($, on, world)
    const ui = await pane($)
    await ui.press({ key: 'widgets' })
    await ui.press({ key: 'catalog-todo' })
    expect(await headerOf(ui, 'todo')).toBe('▾ To Do 12')
    expect(fleetIn(world)).toEqual({
      order: DEFAULT_ORDER,
      collapsed: [],
      shown: ['team', 'reviews', 'todo']
    })
    await ui.press({ key: 'widgets' })
    await ui.unmount()
    const reopened = await pane($)
    expect(await headerOf(reopened, 'todo')).toBe('▾ To Do 12')
    await reopened.unmount()
  })

  test('the catalog removes a shown widget and moves one up or down', async ($, on) => {
    const world = worldOf(fleetStore({ shown: ['team', 'reviews', 'todo'] }))
    await start($, on, world)
    const ui = await pane($)
    await ui.press({ key: 'widgets' })
    await ui.press({ key: 'catalog-down-team' })
    await ui.press({ key: 'catalog-todo' })
    expect(fleetIn(world)).toEqual({
      order: ['review', 'team', 'reviews', 'todo', 'actions', 'metrics'],
      collapsed: [],
      shown: ['team', 'reviews']
    })
    expect(await ui.find({ type: 'Box', key: 'layout-header-todo' })).toBeUndefined()
    await ui.press({ key: 'widgets' })
    await ui.unmount()
  })

  test('the Metrics widget draws the merges per day, the lead time and each account', async ($, on) => {
    const world = worldOf(fleetStore({ shown: ['metrics'] }))
    await start($, on, world, 'en', { ...STATE, metrics: METRICS })
    const ui = await pane($)
    expect(await headerOf(ui, 'metrics')).toBe('▾ Metrics')
    const rows = shownOf(await ui.find({ type: 'Box', key: 'section-metrics' }))
    expect(rows).toContain('▁▅█ 6 merged · 3 days')
    expect(rows).toContain('lead time median 1d 2h · 6 tickets')
    expect(rows).toContain('● lead@example.com')
    expect(rows).toContain('92%')
    await ui.press({ key: 'layout-toggle-metrics' })
    expect(shownOf(await ui.find({ type: 'Box', key: 'section-metrics' }))).not.toContain('merged')
    await ui.unmount()
  })

  test("a member's Panel, or an older host's, says where the metrics come from", async ($, on) => {
    const world = worldOf(fleetStore({ shown: ['metrics'] }))
    await start($, on, world)
    const ui = await pane($)
    expect(shownOf(await ui.find({ type: 'Box', key: 'section-metrics' }))).toContain(
      "Metrics show in the lead's Panel"
    )
    await ui.unmount()
  })

  test('on a phone the Widgets chip opens a catalog of touch-sized chips', async ($, on) => {
    const world = worldOf()
    await start($, on, world)
    const ui = await pane($, 40)
    await ui.press({ key: 'widgets' })
    const chip = await ui.find({ type: 'Button', key: 'catalog-todo' })
    expect(shownOf(chip)).toContain('○ To Do')
    expect(shownOf(chip).split('\n')).toHaveLength(3)
    await ui.press({ key: 'widgets' })
    await ui.unmount()
  })
})

const layout = async ($: Engine, args = '') =>
  (await $.command.run({ command: 'orca-game:layout', args } as never)) as { text: string }

const fleetIn = (world: World) =>
  (world.store.get(LAYOUT_KEY) as { projects: Record<string, { fleet: unknown }> }).projects[
    'repo-1'
  ]?.fleet

describe('/orca-game:layout', () => {
  test('lists each section in order with its state', async ($, on) => {
    const world = worldOf({
      version: 1,
      projects: {
        'repo-1': {
          fleet: {
            order: ['todo', 'team', 'review', 'reviews', 'actions'],
            collapsed: ['todo'],
            hidden: ['actions']
          }
        }
      }
    })
    await start($, on, world)
    expect((await layout($)).text).toBe(
      [
        'Panel layout for this project:',
        '1. To Do (todo): collapsed',
        '2. Team (team): shown',
        '3. Review (review): shown',
        '4. My PRs (reviews): shown',
        '5. Actions (actions): hidden',
        '6. Metrics (metrics): hidden',
        'Change it with /orca-game:layout reset, add <section>, remove <section> or move <section> up|down. Press ▾ or ▸ in the Panel to collapse a section.'
      ].join('\n')
    )
    expect(world.writes).toEqual([])
  })

  test('hides, shows and moves a section, and the Panel follows', async ($, on) => {
    const world = worldOf()
    await start($, on, world)
    await layout($, 'hide team')
    await layout($, 'move todo up')
    expect(fleetIn(world)).toEqual({
      order: ['team', 'review', 'todo', 'reviews', 'actions', 'metrics'],
      collapsed: [],
      shown: ['reviews']
    })
    const ui = await pane($)
    expect(await ui.find({ type: 'Box', key: 'layout-header-team' })).toBeUndefined()
    await ui.unmount()
    const shown = await layout($, 'show team')
    expect(shown.text.split('\n')[1]).toBe('1. Team (team): shown')
  })

  test('reset brings the default back', async ($, on) => {
    const world = worldOf({
      version: 1,
      projects: {
        'repo-1': { fleet: { order: ['actions'], collapsed: ['team'], hidden: ['todo'] } }
      }
    })
    await start($, on, world)
    await layout($, 'reset')
    expect(fleetIn(world)).toEqual({
      order: DEFAULT_ORDER,
      collapsed: [],
      shown: ['team', 'reviews']
    })
  })

  test('an unknown word answers with how to use it and changes nothing', async ($, on) => {
    const world = worldOf()
    await start($, on, world)
    expect((await layout($, 'hide quests')).text).toBe(
      'Unknown section "quests". Sections: team, review, reviews, todo, actions, metrics.'
    )
    expect((await layout($, 'move todo sideways')).text).toContain('/orca-game:layout reset')
    expect(world.writes).toEqual([])
  })

  test('answers in Spanish and takes Spanish section names', async ($, on) => {
    const world = worldOf()
    await start($, on, world, 'es')
    const answer = await layout($, 'ocultar equipo')
    expect(answer.text.split('\n')[0]).toBe('Diseño del Panel de este proyecto:')
    expect(answer.text).toContain('Equipo (team): oculta')
  })

  test('add and remove take the place of show and hide, in English and Spanish', async ($, on) => {
    const world = worldOf(fleetStore({}))
    await start($, on, world)
    await layout($, 'add todo')
    expect(fleetIn(world)).toMatchObject({ shown: ['team', 'reviews', 'todo'] })
    await layout($, 'remove team')
    expect(fleetIn(world)).toMatchObject({ shown: ['reviews', 'todo'] })
    await layout($, 'añadir actions')
    expect(fleetIn(world)).toMatchObject({ shown: ['reviews', 'todo', 'actions'] })
    await layout($, 'quitar reviews')
    expect(fleetIn(world)).toMatchObject({ shown: ['todo', 'actions'] })
  })
})

const band = ($: Engine) =>
  $.ui.mount({
    plugin: 'orca-game',
    surface: 'terminal',
    component: 'AbovePrompt',
    viewport: { columns: 124, rows: 40, isFullscreen: true },
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows: 8,
      bodyColumns: 120,
      scroll: { offset: 0, bodyRows: 7 },
      view: {}
    }
  })

describe('the layout hint', () => {
  test('opening the Panel says once how to collapse its sections', async ($, on) => {
    const world = worldOf()
    await start($, on, world)
    const ui = await band($)
    await ui.press({ key: 'band-panel' })
    await ui.press({ key: 'band-panel' })
    const hint =
      'Tip: press ▾ beside a Panel section to collapse it; /orca-game:layout hides, moves or resets them.'
    expect(world.toasts.filter((one) => one === hint)).toEqual([hint])
    expect(world.store.has(LAYOUT_KEY)).toBe(false)
    await ui.unmount()
  })
})

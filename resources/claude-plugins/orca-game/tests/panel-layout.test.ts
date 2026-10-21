// Runs under `claude plugin test`: the Panel's sections collapse, and the layout comes back from `$.store`.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

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

const engine = (on: On, world: World) => {
  mock.env(on, { ORCA_GAME_CLI: ORCA_CLI, ORCA_GAME_LOCALE: 'en' })
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
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout: JSON.stringify(STATE),
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

const start = async ($: Engine, on: On, world: World) => {
  const clock = mock.clock(on)
  engine(on, world)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await clock.settle()
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
const headerOf = async (ui: Mounted, section: string) =>
  shownOf(await ui.find({ type: 'Box', key: `layout-header-${section}` }))
const cardsOf = async (ui: Mounted) =>
  (await ui.findAll({ type: 'Box' })).filter((one) => one.key?.startsWith('card-tab-1:'))

describe('panel layout', () => {
  test('an untouched layout draws every section expanded and stores nothing', async ($, on) => {
    const world = worldOf()
    await start($, on, world)
    const ui = await pane($)
    expect(await headerOf(ui, 'team')).toBe('▾ Team 3')
    expect(await headerOf(ui, 'todo')).toBe('▾ To Do 12')
    expect((await cardsOf(ui)).length).toBe(3)
    expect(shownOf(await ui.find({ type: 'Box', key: 'project-todo' }))).toContain('ORCA-1')
    expect(world.writes).toEqual([])
    await ui.unmount()
  })

  test('pressing a section header collapses it to one line and stores it for the project', async ($, on) => {
    const world = worldOf()
    await start($, on, world)
    const ui = await pane($)
    await ui.press({ key: 'layout-toggle-todo' })
    expect(await headerOf(ui, 'todo')).toBe('▸ To Do 12')
    expect(shownOf(await ui.find({ type: 'Box', key: 'project-todo' }))).not.toContain('ORCA-1')
    expect(world.writes).toEqual([
      [
        LAYOUT_KEY,
        {
          version: 1,
          projects: {
            'repo-1': {
              fleet: {
                order: ['team', 'review', 'reviews', 'todo', 'actions'],
                collapsed: ['todo'],
                hidden: []
              }
            }
          }
        }
      ]
    ])
    await ui.press({ key: 'layout-toggle-team' })
    expect(await headerOf(ui, 'team')).toBe('▸ Team 3')
    expect(await cardsOf(ui)).toEqual([])
    await ui.press({ key: 'layout-toggle-todo' })
    expect(await headerOf(ui, 'todo')).toBe('▾ To Do 12')
    await ui.unmount()
  })

  test('a stored layout comes back: collapsed, hidden and moved sections', async ($, on) => {
    const world = worldOf({
      version: 1,
      projects: {
        'repo-1': { fleet: { order: ['todo', 'team'], collapsed: ['team'], hidden: ['review'] } }
      }
    })
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
    const world = worldOf()
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
    const world = worldOf({
      version: 1,
      projects: { 'repo-1': { fleet: { order: [], collapsed: ['review'], hidden: [] } } }
    })
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
})

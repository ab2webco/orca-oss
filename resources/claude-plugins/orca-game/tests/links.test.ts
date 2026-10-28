// Runs under `claude plugin test`: game links in the band and the fleet pane.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'
import type { On } from 'claude-code'

import { cellWidthOf } from '../hooks/cell-width'
import { cardLayoutOf } from '../hooks/fleet-tiles'
import type { GameState } from '../types'

const ORCA_CLI = '/opt/orca/bin/orca'
const CHECKS = 'https://github.com/o/r/pull/42/checks'

const tambora = {
  name: 'Tambora',
  id: 'TR-CIN-12',
  url: 'https://tambora.example/projects/CIN/testruns/TR-CIN-12',
  at: 2,
  running: true
}

const agent = (name: string, state: string, isLeader = false) => ({
  paneKey: `tab-1:${name}`,
  displayName: name,
  agentType: 'claude',
  state,
  toolName: null,
  isLeader
})

const STATE = {
  config: {},
  sources: {},
  warnings: [],
  worktree: { id: 'repo-1::/w', path: '/w', branch: 'feat/game', displayName: 'game' },
  agents: [
    { ...agent('lead', 'working', true), activity: { ...tambora, running: false } },
    { ...agent('builder', 'working'), activity: tambora },
    agent('tester', 'waiting')
  ],
  review: {
    provider: 'github',
    number: 42,
    title: 'feat: game',
    url: 'https://github.com/o/r/pull/42',
    state: 'open',
    ci: 'failure'
  },
  workItem: {
    provider: 'jira',
    identifier: 'CIN-123',
    title: 'Seat map',
    url: 'https://jira.example/browse/CIN-123',
    status: 'In Progress',
    statusGroup: 'in_progress'
  },
  links: [
    {
      id: 'review',
      kind: 'review',
      provider: 'github',
      label: 'PR #42',
      url: 'https://github.com/o/r/pull/42',
      status: 'open',
      tone: 'pending'
    },
    {
      id: 'ci',
      kind: 'ci',
      provider: 'github',
      label: 'CI',
      url: CHECKS,
      status: 'failure',
      tone: 'danger'
    },
    {
      id: 'workItem',
      kind: 'workItem',
      provider: 'jira',
      label: 'CIN-123',
      url: 'https://jira.example/browse/CIN-123',
      tone: 'pending'
    },
    {
      id: 'project:0',
      kind: 'project',
      provider: 'project',
      label: 'Test plan',
      url: 'https://tambora.example/projects/CIN'
    },
    {
      id: 'activity:tab-1:builder',
      kind: 'activity',
      provider: 'Tambora',
      label: 'TR-CIN-12',
      url: tambora.url,
      status: 'running',
      tone: 'pending'
    }
  ],
  activity: { ...tambora, running: false }
}

type World = { calls: string[][]; toasts: string[]; tabExit: number }

const engine = (on: On, world: World) => {
  mock.env(on, { ORCA_GAME_CLI: ORCA_CLI })
  on('session.start', ($s, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.root', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 's1' }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.toast', ($s, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: [] }) as never)
  on('ui.status', () => ({ value: undefined }))
  on('process.run', ($s, e) => {
    world.calls.push([...e.argv])
    const isTab = e.argv[1] === 'tab'
    return {
      value: {
        exitCode: isTab ? world.tabExit : 0,
        stdout: isTab ? '{}' : JSON.stringify(STATE),
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false
      }
    }
  })
}

type Drawn = { type?: unknown; key?: unknown; props?: { href?: unknown }; children?: unknown }
const isDrawn = (one: unknown): one is Drawn => typeof one === 'object' && one !== null

const shownOf = (one: unknown): string => {
  if (typeof one === 'string') {
    return one
  }
  return isDrawn(one) && Array.isArray(one.children) ? one.children.map(shownOf).join('') : ''
}

const elementsOf = (one: unknown): Drawn[] =>
  isDrawn(one) && Array.isArray(one.children) ? one.children.filter(isDrawn) : []

const linksIn = (one: unknown): Drawn[] =>
  isDrawn(one) ? [...(one.type === 'Link' ? [one] : []), ...elementsOf(one).flatMap(linksIn)] : []

const start = async ($: Engine, on: On, world: World) => {
  const clock = mock.clock(on)
  engine(on, world)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await clock.settle()
  return clock
}

const band = ($: Engine, columns: number) =>
  $.ui.mount({
    plugin: 'orca-game',
    surface: 'terminal',
    component: 'AbovePrompt',
    viewport: { columns: columns + 4, rows: 40, isFullscreen: true },
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows: 8,
      bodyColumns: columns,
      scroll: { offset: 0, bodyRows: 7 },
      view: {}
    }
  })

const pane = ($: Engine, columns: number) =>
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

const worldOf = (): World => ({ calls: [], toasts: [], tabExit: 0 })

describe('band links', () => {
  for (const columns of [40, 60, 120]) {
    test(`link chips fit ${columns} columns whole and each opens its URL`, async ($, on) => {
      await start($, on, worldOf())
      const ui = await band($, columns)
      const rows = (await ui.findAll({ type: 'Box' })).filter((one) =>
        one.key?.startsWith('band-chips-')
      )
      expect(rows.length).toBeLessThanOrEqual(2)
      for (const row of rows) {
        const width = cellWidthOf(shownOf(row)) + Math.max(0, elementsOf(row).length - 1)
        expect(width).toBeLessThanOrEqual(columns)
      }
      const hrefs = rows.flatMap(linksIn).map((one) => one.props?.href)
      expect(hrefs).toContain('https://github.com/o/r/pull/42')
      expect(hrefs).toContain('https://jira.example/browse/CIN-123')
      if (columns === 120) {
        expect(hrefs).toEqual(
          expect.arrayContaining([CHECKS, tambora.url, 'https://tambora.example/projects/CIN'])
        )
        const shown = rows.map(shownOf).join('')
        expect(shown).toContain('▶ Tambora TR-CIN-12')
        expect(shown).toContain('↗ Test plan')
      }
      await ui.unmount()
    })
  }

  test('the CI need opens the checks page and the line fits the band', async ($, on) => {
    await start($, on, worldOf())
    const ui = await band($, 60)
    const needs = await ui.find({ type: 'Box', key: 'band-needs' })
    expect(shownOf(needs)).toBe('Needs you: tester waiting on you · #42 CI failing')
    expect(linksIn(needs).map((one) => one.props?.href)).toEqual([CHECKS])
    // One truncating line, so a terminal cuts it rather than wrapping its parts.
    expect(elementsOf(needs).map((one) => one.type)).toEqual(['Text'])
    await ui.unmount()

    const narrow = await band($, 32)
    expect(
      cellWidthOf(shownOf(await narrow.find({ type: 'Box', key: 'band-needs' })))
    ).toBeLessThanOrEqual(32)
    await narrow.unmount()
  })
})

describe('fleet pane links', () => {
  test('a tile shows its agent activity as a link, cut to the card', async ($, on) => {
    await start($, on, worldOf())
    for (const columns of [40, 120]) {
      const ui = await pane($, columns)
      const tile = await ui.find({ type: 'Box', key: 'card-tab-1:builder' })
      const links = linksIn(tile)
      expect(links.map((one) => one.props?.href)).toEqual([tambora.url])
      const text = shownOf(links[0])
      expect(text.startsWith('▶ Tambora')).toBe(true)
      expect(cellWidthOf(text)).toBeLessThanOrEqual(cardLayoutOf(columns).room)
      expect(linksIn(await ui.find({ type: 'Box', key: 'card-tab-1:tester' }))).toEqual([])
      await ui.unmount()
    }
  })

  test('i, o, c, w and a open the work item, review, CI, project link and activity in Orca', async ($, on) => {
    const world = worldOf()
    await start($, on, world)
    const ui = await pane($, 120)
    const keys = {
      'open-work-item': ['i', 'https://jira.example/browse/CIN-123'],
      'open-review': ['o', 'https://github.com/o/r/pull/42'],
      'open-ci': ['c', CHECKS],
      'open-project': ['w', 'https://tambora.example/projects/CIN'],
      'open-activity': ['a', tambora.url]
    } as const
    for (const [key, [hotkey, url]] of Object.entries(keys)) {
      const button = await ui.find({ type: 'Button', key })
      expect(button?.props).toMatchObject({ hotkey })
      await ui.press({ key })
      expect(world.calls.at(-1)).toEqual([
        ORCA_CLI,
        'tab',
        'create',
        '--url',
        url,
        '--worktree',
        'id:repo-1::/w',
        '--json'
      ])
    }
    expect(await ui.find({ type: 'Button', key: 'pet' })).toMatchObject({
      props: { hotkey: 'p' }
    })
    expect(world.toasts).toEqual([])
    await ui.unmount()
  })

  test('a link Orca could not open says so', async ($, on) => {
    const world = { ...worldOf(), tabExit: 1 }
    await start($, on, world)
    const ui = await pane($, 120)
    await ui.press({ key: 'open-ci' })
    expect(world.toasts).toEqual(['Could not open CI'])
    await ui.unmount()
  })
})

// What a mod from before game links stored: its fleet state had no `links` and no `activity`.
const OLDER_MOD: Plugin = {
  name: 'older-orca-game',
  register(on) {
    on('state.set', { plugin: 'orca-game', key: 'fleet' }, (_$, e, next) => {
      if (e.key !== 'fleet' || e.value.state === null) {
        return next(e)
      }
      const { links: _links, activity: _activity, ...older } = e.value.state
      // Why: the stored shape is the older mod's, which this version's types no longer describe.
      return next({ ...e, value: { ...e.value, state: older as GameState } })
    })
  }
}

describe('a fleet left by an older mod', () => {
  // Why: a hot reload keeps the plugin's atoms, so the new mod first draws the old version's state.
  test(
    'the band and the pane still draw a state with no links',
    { plugins: [OLDER_MOD] },
    async ($, on) => {
      const clock = mock.clock(on)
      engine(on, worldOf())
      await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
      await clock.settle()
      const ui = await band($, 60)
      expect(await ui.find({ type: 'Button', key: 'band-panel' })).toBeDefined()
      await ui.unmount()
      const fleetPane = await pane($, 60)
      expect(await fleetPane.find({ type: 'Button', key: 'refresh' })).toBeDefined()
      await fleetPane.unmount()
    }
  )
})

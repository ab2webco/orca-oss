// Runs under `claude plugin test`: `/orca-game:layout` stores the sections the native panel carries over.
import { describe, expect, mock } from 'claude-code/testing'
import { test } from './test-budget'
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

const start = async ($: Engine, on: On, world: World, locale = 'en', state: unknown = STATE) => {
  const clock = mock.clock(on)
  engine(on, world, locale, state)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await clock.settle()
  return clock
}

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

  test('hides, shows and moves a section', async ($, on) => {
    const world = worldOf()
    await start($, on, world)
    await layout($, 'hide team')
    await layout($, 'move todo up')
    expect(fleetIn(world)).toEqual({
      order: ['team', 'review', 'todo', 'reviews', 'actions', 'metrics'],
      collapsed: [],
      shown: ['reviews']
    })
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

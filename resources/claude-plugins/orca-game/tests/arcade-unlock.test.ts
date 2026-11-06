// Runs under `claude plugin test`: a member's perfect merge, seen by its lead between two polls of
// `game state`, celebrates once in the scene and opens no pane: the host saves the play for the
// Team panel (ORCA-1053). Never twice for the same merge, never from a member's pane.
import { describe, expect, mock } from 'claude-code/testing'
import { test } from './test-budget'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { ARCADE_PANE } from '../hooks/arcade-pane'
import { ARCADE_OFFERS_KEY } from '../hooks/arcade-unlock'
import { POLL_EVERY_MS } from '../hooks/fleet-sync'

const review = (perfectMerge?: boolean) => ({
  provider: 'github',
  number: 41,
  title: 'feat: x',
  url: 'https://github.com/o/r/pull/41',
  state: perfectMerge === undefined ? 'open' : 'merged',
  ci: 'success',
  ...(perfectMerge === undefined ? {} : { perfectMerge })
})

const member = (patch: Record<string, unknown> = {}) => ({
  paneKey: 'p-12',
  displayName: 'ORCA-12',
  agentType: 'claude',
  state: 'working',
  toolName: null,
  isLeader: false,
  isMember: true,
  worktree: { id: 'wt-12', branch: 'feat/orca-12', displayName: 'orca-12' },
  review: review(),
  ...patch
})

const WAITING = {
  paneKey: 't:scribe',
  displayName: 'scribe',
  agentType: 'claude',
  state: 'waiting',
  toolName: null,
  isLeader: false
}

type World = {
  agents: unknown[]
  role: string
  rewards: boolean
  opened: { id: string; title?: string; focus?: boolean }[]
  store: Map<string, unknown>
  merges?: unknown[]
}

const start = async ($: Engine, on: On, patch: Partial<World> = {}) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 27, 12) })
  mock.env(on, { ORCA_GAME_CLI: '/opt/orca/bin/orca', ORCA_GAME_LOCALE: 'en' })
  const world: World = {
    agents: [member()],
    role: 'lead',
    rewards: true,
    opened: [],
    store: new Map(),
    ...patch
  }
  on('session.start', ($s, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.root', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 's1' }))
  on('store.get', ($s, e) => ({ value: world.store.get(e.key) }))
  on('store.set', ($s, e) => {
    world.store.set(e.key, e.value)
    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: [] }) as never)
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', ($s, e) => {
    world.opened.push(e)
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: [] }))
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout: JSON.stringify({
        id: 'x',
        ok: true,
        result: {
          config: { scene: 'vigilante', rewards: world.rewards },
          sources: {},
          warnings: [],
          worktree: { id: 'wt-main', path: '/w', branch: 'main', displayName: 'main' },
          agents: world.agents,
          review: null,
          workItem: null,
          links: [],
          role: world.role,
          ...(world.merges === undefined ? {} : { merges: world.merges })
        }
      }),
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false
    }
  }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await clock.settle()
  return { clock, world }
}

const panes = (world: World) => world.opened.filter((one) => one.id === ARCADE_PANE)
const celebrated = (world: World) => world.store.get(ARCADE_OFFERS_KEY) ?? []

const mergePerfectly = async (world: World, clock: { advance: (ms: number) => Promise<void> }) => {
  world.agents = [member({ review: review(true) })]
  await clock.advance(POLL_EVERY_MS)
}

describe("a member's perfect merge", () => {
  test('celebrates in its lead scene and opens no pane, with no countdown', async ($, on) => {
    const { clock, world } = await start($, on)
    await mergePerfectly(world, clock)
    expect(celebrated(world)).toEqual(['perfect-merge:github#41@wt-12'])
    await clock.advance(POLL_EVERY_MS * 3)
    expect(panes(world)).toEqual([])
  })

  test('celebrates once, even when the merge shows again after a reload', async ($, on) => {
    const { clock, world } = await start($, on)
    await mergePerfectly(world, clock)
    world.agents = [member()]
    await clock.advance(POLL_EVERY_MS)
    await mergePerfectly(world, clock)
    expect(celebrated(world)).toEqual(['perfect-merge:github#41@wt-12'])
  })

  // Why: a merge the old countdown already offered must not cheer again after the update.
  test('remembers a merge the terminal offered before the update', async ($, on) => {
    const store = new Map<string, unknown>([[ARCADE_OFFERS_KEY, ['perfect-merge:github#41@wt-12']]])
    const { clock, world } = await start($, on, { store })
    await mergePerfectly(world, clock)
    expect(celebrated(world)).toEqual(['perfect-merge:github#41@wt-12'])
  })

  test('never takes the keyboard while a teammate needs the user', async ($, on) => {
    const { clock, world } = await start($, on, { agents: [member(), WAITING] })
    world.agents = [member({ review: review(true) }), WAITING]
    await clock.advance(POLL_EVERY_MS)
    expect(celebrated(world)).toHaveLength(1)
    expect(panes(world)).toEqual([])
  })

  // ORCA-887: the lead or auto-release frees the member right after its merge, before a poll sees it.
  test('celebrates once when the member is released before the next poll sees its merge', async ($, on) => {
    const { clock, world } = await start($, on, { merges: [] })
    world.agents = []
    world.merges = [
      {
        key: 'merged ORCA-12 #41',
        ticket: 'ORCA-12',
        provider: 'github',
        number: 41,
        worktreeId: 'wt-12',
        perfect: true
      }
    ]
    await clock.advance(POLL_EVERY_MS * 4)
    expect(celebrated(world)).toEqual(['perfect-merge:github#41@wt-12'])
    expect(panes(world)).toEqual([])
  })

  test("celebrates nothing from a member's own pane", async ($, on) => {
    const own = await start($, on, { role: 'member' })
    await mergePerfectly(own.world, own.clock)
    expect(celebrated(own.world)).toEqual([])
  })

  test('celebrates nothing with rewards off', async ($, on) => {
    const { clock, world } = await start($, on, { rewards: false })
    await mergePerfectly(world, clock)
    expect(celebrated(world)).toEqual([])
  })

  test('celebrates nothing for a merge the host did not call perfect', async ($, on) => {
    const { clock, world } = await start($, on)
    world.agents = [member({ review: review(false) })]
    await clock.advance(POLL_EVERY_MS)
    expect(celebrated(world)).toEqual([])
  })
})

describe('/orca-game:demo offer', () => {
  test('cheers like a saved play, points to the Team panel and opens no pane', async ($, on) => {
    const { world } = await start($, on, { agents: [] })
    const said = await $.command.run({ command: 'orca-game:demo', args: 'offer' } as never)
    expect(JSON.stringify(said)).toContain('Team panel')
    expect(panes(world)).toEqual([])
    expect(celebrated(world)).toEqual([])
  })
})

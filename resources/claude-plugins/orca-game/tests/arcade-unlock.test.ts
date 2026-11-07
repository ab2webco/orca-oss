// Runs under `claude plugin test`: a member's perfect merge, seen by its lead between two polls of
// `game state`, celebrates once in the scene and opens no pane: the host saves the play for the
// Team panel (ORCA-1053). Never twice for the same merge, never from a member's pane. The offers the
// old countdown kept are sent to the host once, which pays each as a saved play.
import { describe, expect, mock } from 'claude-code/testing'
import { test } from './test-budget'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import {
  ARCADE_CHEERS_KEY,
  ARCADE_OFFERS_KEY,
  ARCADE_OFFERS_MIGRATED_KEY
} from '../hooks/arcade-unlock'
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
  /** Each `orca game arcade` call, and the exit code it answers with. */
  arcadeRuns: string[][]
  arcadeExit: number
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
    arcadeRuns: [],
    arcadeExit: 0,
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
  on('process.run', ($s, e) => {
    if (e.argv[1] === 'game' && e.argv[2] === 'arcade') {
      world.arcadeRuns.push(e.argv.slice(1))
      const result = { ok: true, paid: 2, arcade: { credits: 2, offer: null } }
      return {
        value: {
          exitCode: world.arcadeExit,
          stdout: world.arcadeExit === 0 ? JSON.stringify({ id: 'a', ok: true, result }) : '',
          stderr: world.arcadeExit === 0 ? '' : 'Unknown command: game arcade',
          isStdoutTruncated: false,
          isStderrTruncated: false
        }
      }
    }
    return {
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
    }
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await clock.settle()
  return { clock, world }
}

// Why every pane: the mod has no pane of its own since ORCA-1055, so any open is wrong.
const panes = (world: World) => world.opened
const celebrated = (world: World) => world.store.get(ARCADE_CHEERS_KEY) ?? []

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
    expect(celebrated(world)).toEqual([])
    expect(world.store.get(ARCADE_OFFERS_KEY)).toEqual(['perfect-merge:github#41@wt-12'])
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

const KEPT = ['perfect-merge:github#7@wt-3', 'perfect-merge:gitlab#9@wt-4']
const kept = () => new Map<string, unknown>([[ARCADE_OFFERS_KEY, KEPT]])
const MIGRATE = ['game', 'arcade', 'migrate', '--offers', JSON.stringify(KEPT), '--json']

describe('the offers the old countdown kept', () => {
  test('go to the host once from the lead pane, which pays each as a saved play', async ($, on) => {
    const { clock, world } = await start($, on, { store: kept() })
    await clock.advance(POLL_EVERY_MS * 3)
    expect(world.arcadeRuns).toEqual([MIGRATE])
    expect(world.store.get(ARCADE_OFFERS_MIGRATED_KEY)).toBe(true)
  })

  test('are never sent again once the host took them', async ($, on) => {
    const store = kept()
    store.set(ARCADE_OFFERS_MIGRATED_KEY, true)
    const { clock, world } = await start($, on, { store })
    await clock.advance(POLL_EVERY_MS)
    expect(world.arcadeRuns).toEqual([])
  })

  // Why: an Orca older than `game arcade` keeps no credits; the offers wait for one that does.
  test('wait for a later session when Orca is too old to take them', async ($, on) => {
    const { clock, world } = await start($, on, { store: kept(), arcadeExit: 1 })
    await clock.advance(POLL_EVERY_MS * 3)
    expect(world.arcadeRuns).toEqual([MIGRATE])
    expect(world.store.get(ARCADE_OFFERS_MIGRATED_KEY)).toBeUndefined()
  })

  test("are not sent from a member's pane", async ($, on) => {
    const own = await start($, on, { role: 'member', store: kept() })
    await own.clock.advance(POLL_EVERY_MS)
    expect(own.world.arcadeRuns).toEqual([])
  })

  test('are not sent when the terminal kept none', async ($, on) => {
    const { clock, world } = await start($, on)
    await clock.advance(POLL_EVERY_MS)
    expect(world.arcadeRuns).toEqual([])
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

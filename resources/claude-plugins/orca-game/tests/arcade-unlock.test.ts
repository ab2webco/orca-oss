// Runs under `claude plugin test`: a member's perfect merge, seen by its lead between two polls of
// `game state`, offers one arcade run; never twice for the same merge, never from a member's pane.
import { describe, expect, mock, test } from 'claude-code/testing'
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
          role: world.role
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

const offers = (world: World) => world.opened.filter((one) => one.id === ARCADE_PANE)

const mergePerfectly = async (world: World, clock: { advance: (ms: number) => Promise<void> }) => {
  world.agents = [member({ review: review(true) })]
  await clock.advance(POLL_EVERY_MS)
}

describe("a member's perfect merge", () => {
  test('offers one arcade run in its lead pane, taking the keyboard from an empty prompt', async ($, on) => {
    const { clock, world } = await start($, on)
    expect(offers(world)).toEqual([])
    await mergePerfectly(world, clock)
    expect(offers(world)).toMatchObject([{ title: 'Arcade · unlocked', focus: true }])
    await clock.advance(POLL_EVERY_MS * 3)
    expect(offers(world)).toHaveLength(1)
  })

  test('is offered once, even when the merge shows again after a reload', async ($, on) => {
    const { clock, world } = await start($, on)
    await mergePerfectly(world, clock)
    expect(world.store.get(ARCADE_OFFERS_KEY)).toEqual(['perfect-merge:github#41@wt-12'])
    world.agents = [member()]
    await clock.advance(POLL_EVERY_MS)
    await mergePerfectly(world, clock)
    expect(offers(world)).toHaveLength(1)
  })

  test('remembers an offer made before a reload', async ($, on) => {
    const store = new Map<string, unknown>([[ARCADE_OFFERS_KEY, ['perfect-merge:github#41@wt-12']]])
    const { clock, world } = await start($, on, { store })
    await mergePerfectly(world, clock)
    expect(offers(world)).toEqual([])
  })

  test('waits on hold, without the keyboard, while a teammate needs the user', async ($, on) => {
    const { clock, world } = await start($, on, { agents: [member(), WAITING] })
    world.agents = [member({ review: review(true) }), WAITING]
    await clock.advance(POLL_EVERY_MS)
    expect(offers(world)).toHaveLength(1)
    expect(offers(world)[0]?.focus).toBeUndefined()
  })

  test("offers nothing from a member's own pane", async ($, on) => {
    const own = await start($, on, { role: 'member' })
    await mergePerfectly(own.world, own.clock)
    expect(offers(own.world)).toEqual([])
  })

  test('offers nothing with rewards off', async ($, on) => {
    const { clock, world } = await start($, on, { rewards: false })
    await mergePerfectly(world, clock)
    expect(offers(world)).toEqual([])
  })

  test('offers nothing for a merge the host did not call perfect', async ($, on) => {
    const { clock, world } = await start($, on)
    world.agents = [member({ review: review(false) })]
    await clock.advance(POLL_EVERY_MS)
    expect(offers(world)).toEqual([])
  })
})

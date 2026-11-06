import { describe, expect, it, vi } from 'vitest'
import type { EngineInterface } from 'claude-code'

import { gameHideTabArgvOf } from '../hooks/game-config'
import { PANEL_LAYOUT_KEY, owesHiddenPrsTab, withTabsMigrated } from '../hooks/panel-layout'
import { migrateHiddenReviews } from '../hooks/panel-layout-store'

const ORDER = ['team', 'review', 'reviews', 'todo', 'actions', 'metrics']

const hiding = (extra: Record<string, unknown> = {}) => ({
  version: 2,
  projects: {
    'repo-1': { fleet: { order: ORDER, collapsed: [], shown: ['team'] }, ...extra }
  }
})

const keeping = {
  version: 2,
  projects: { 'repo-1': { fleet: { order: ORDER, collapsed: [], shown: ['team', 'reviews'] } } }
}

function engineWith(seeded: unknown): {
  $: EngineInterface
  store: Map<string, unknown>
  writes: unknown[]
} {
  const store = new Map<string, unknown>([[PANEL_LAYOUT_KEY, seeded]])
  const writes: unknown[] = []
  const $ = {
    store: {
      get: async (key: string) => store.get(key),
      set: async (key: string, value: unknown) => {
        writes.push(value)
        store.set(key, value)
      }
    }
  } as unknown as EngineInterface
  return { $, store, writes }
}

describe('owesHiddenPrsTab', () => {
  it('owes the tab for a project that hid My PRs', () => {
    expect(owesHiddenPrsTab(hiding(), 'repo-1')).toBe(true)
  })

  it('reads a version 1 layout that hid My PRs the same way', () => {
    const stored = {
      version: 1,
      projects: { 'repo-1': { fleet: { order: ORDER, collapsed: [], hidden: ['reviews'] } } }
    }

    expect(owesHiddenPrsTab(stored, 'repo-1')).toBe(true)
  })

  it('owes nothing for a layout that kept My PRs', () => {
    expect(owesHiddenPrsTab(keeping, 'repo-1')).toBe(false)
  })

  it('owes nothing for a project with no stored Panel, or another project', () => {
    expect(owesHiddenPrsTab(undefined, 'repo-1')).toBe(false)
    expect(owesHiddenPrsTab(hiding(), 'repo-2')).toBe(false)
  })

  it('owes nothing once migrated', () => {
    expect(owesHiddenPrsTab(hiding({ tabsMigrated: true }), 'repo-1')).toBe(false)
  })

  it('leaves a value a newer build wrote alone', () => {
    expect(owesHiddenPrsTab({ ...hiding(), version: 99 }, 'repo-1')).toBe(false)
  })
})

describe('withTabsMigrated', () => {
  it('marks the project and keeps its layout and the other projects', () => {
    const other = { fleet: { order: ORDER, collapsed: ['team'], shown: ['team'] } }
    const stored = hiding()
    const next = withTabsMigrated(
      { ...stored, projects: { 'repo-2': other, ...stored.projects } },
      'repo-1'
    )

    expect(next?.projects).toEqual({
      'repo-2': other,
      'repo-1': { ...stored.projects['repo-1'], tabsMigrated: true }
    })
  })

  it('never overwrites a value a newer build wrote', () => {
    expect(withTabsMigrated({ ...hiding(), version: 99 }, 'repo-1')).toBeNull()
  })
})

describe('migrateHiddenReviews', () => {
  it('hides the tab once and stores the marker', async () => {
    const { $, store } = engineWith(hiding())
    const hideTab = vi.fn().mockResolvedValue(true)

    await migrateHiddenReviews($, 'repo-1', hideTab)
    await migrateHiddenReviews($, 'repo-1', hideTab)

    expect(hideTab).toHaveBeenCalledTimes(1)
    expect(owesHiddenPrsTab(store.get(PANEL_LAYOUT_KEY), 'repo-1')).toBe(false)
  })

  it('changes nothing for a layout that kept My PRs', async () => {
    const { $, writes } = engineWith(keeping)
    const hideTab = vi.fn().mockResolvedValue(true)

    await migrateHiddenReviews($, 'repo-1', hideTab)

    expect(hideTab).not.toHaveBeenCalled()
    expect(writes).toEqual([])
  })

  it('stores no marker when Orca could not hide it, so a later session tries again', async () => {
    const { $, writes } = engineWith(hiding())

    await migrateHiddenReviews($, 'repo-1', async () => false)

    expect(writes).toEqual([])
  })
})

describe('gameHideTabArgvOf', () => {
  it('names the tab through the CLI', () => {
    expect(gameHideTabArgvOf('/opt/orca', 'prs')).toEqual([
      '/opt/orca',
      'game',
      'hide-tab',
      'prs',
      '--json'
    ])
  })

  it('is undefined with no CLI', () => {
    expect(gameHideTabArgvOf(undefined, 'prs')).toBeUndefined()
  })
})

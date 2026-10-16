import { describe, expect, it } from 'vitest'

import type { GameProjectWork, GameState } from '../types'
import { stateChipsOf, type BandChip } from '../hooks/band-chips'
import { gameStateOf } from '../hooks/game-state'
import { paneLinksOf } from '../hooks/pane-links'

const PROJECT: GameProjectWork = {
  reviews: {
    provider: 'github',
    total: 2,
    url: 'https://github.com/o/r/pulls?q=is%3Apr',
    items: [
      {
        id: '#469',
        title: 'Spawn race',
        url: 'https://github.com/o/r/pull/469',
        status: 'failure',
        tone: 'danger'
      },
      {
        id: '#470',
        title: 'Settings',
        url: 'https://github.com/o/r/pull/470',
        status: 'success',
        tone: 'success'
      }
    ]
  },
  todo: {
    provider: 'plane',
    total: 3,
    url: 'https://app.plane.so/w/workspace-views/assigned/',
    items: [
      { id: 'ORCA-1', title: 'Mine', url: 'https://app.plane.so/w/browse/ORCA-1/', status: 'Todo' }
    ]
  }
}

const STATE: GameState = {
  config: {},
  warnings: [],
  worktree: { id: 'repo::/w', path: '/w', branch: 'main', displayName: 'w' },
  agents: [],
  review: null,
  workItem: null,
  extensions: { scenes: [] },
  links: [],
  activity: null,
  project: PROJECT
}

const COUNTS = { working: 0, idle: 0, done: 0, waiting: 0 }
const chipsOf = (state: GameState): BandChip[] => stateChipsOf(state, COUNTS, 0, '', false)
const byKey = (chips: readonly BandChip[], key: string) => chips.find((one) => one.key === key)

describe('project work from Orca', () => {
  it('keeps valid lists and items, drops unsafe urls and caps what it keeps', () => {
    const items = Array.from({ length: 12 }, (_, at) => ({
      id: `#${at}`,
      title: `PR ${at}`,
      url: at === 0 ? 'javascript:alert(1)' : `https://github.com/o/r/pull/${at}`,
      tone: at === 1 ? 'loud' : 'danger'
    }))
    const state = gameStateOf({
      ...STATE,
      project: {
        reviews: { provider: 'github', total: 12, url: 'file:///etc', items },
        todo: { provider: 'plane', total: 'many', url: null, items: [] }
      }
    })

    expect(state?.project?.reviews?.url).toBeNull()
    expect(state?.project?.reviews?.total).toBe(12)
    expect(state?.project?.reviews?.items.map((one) => one.id)).toEqual([
      '#1',
      '#2',
      '#3',
      '#4',
      '#5'
    ])
    expect(state?.project?.reviews?.items[0]?.tone).toBeUndefined()
    expect(state?.project?.todo).toBeNull()
  })

  it('has no project work from a host older than it', () => {
    const { project: _project, ...older } = STATE
    expect(gameStateOf(older)?.project).toBeUndefined()
  })
})

describe('project chips', () => {
  it('draws my PRs colored by the worst CI and my To Do, each opening its list', () => {
    const chips = chipsOf(STATE)
    expect(byKey(chips, 'band-reviews')).toMatchObject({
      labels: ['⇄ My PRs 2', '⇄ 2'],
      href: 'https://github.com/o/r/pulls?q=is%3Apr',
      color: 'red',
      isLink: true
    })
    expect(byKey(chips, 'band-todo')).toMatchObject({
      labels: ['☐ To Do 3', '☐ 3'],
      href: 'https://app.plane.so/w/workspace-views/assigned/',
      isLink: true
    })
  })

  it('names GitLab reviews MRs and draws a list with no url as plain text', () => {
    const chips = chipsOf({
      ...STATE,
      project: {
        reviews: { provider: 'gitlab', total: 1, url: null, items: [] },
        todo: null
      }
    })
    expect(byKey(chips, 'band-reviews')).toMatchObject({ labels: ['⇄ My MRs 1', '⇄ 1'] })
    expect(byKey(chips, 'band-reviews')?.href).toBeUndefined()
    expect(byKey(chips, 'band-todo')).toBeUndefined()
  })

  it('ranks an empty list after every other link', () => {
    const chips = chipsOf({
      ...STATE,
      project: { reviews: { ...PROJECT.reviews!, total: 0, items: [] }, todo: PROJECT.todo }
    })
    expect(byKey(chips, 'band-reviews')?.priority).toBeGreaterThan(
      byKey(chips, 'band-todo')?.priority ?? 0
    )
  })

  it('draws no project chips without project work', () => {
    const chips = chipsOf({ ...STATE, project: undefined })
    expect(chips.some((one) => one.key === 'band-reviews' || one.key === 'band-todo')).toBe(false)
  })
})

describe('project pane links', () => {
  it('opens my PRs on g and my To Do on t', () => {
    expect(paneLinksOf(STATE)).toEqual([
      {
        key: 'open-reviews',
        hotkey: 'g',
        label: 'My PRs 2',
        url: 'https://github.com/o/r/pulls?q=is%3Apr'
      },
      {
        key: 'open-todo',
        hotkey: 't',
        label: 'To Do 3',
        url: 'https://app.plane.so/w/workspace-views/assigned/'
      }
    ])
  })
})

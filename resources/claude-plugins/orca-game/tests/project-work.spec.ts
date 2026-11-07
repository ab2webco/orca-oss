import { describe, expect, it } from 'vitest'

import type { GameProjectWork, GameState } from '../types'
import { gameStateOf } from '../hooks/game-state'
import { listActionOf, todoActionOf } from '../hooks/lead-actions'

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
    expect(state?.project?.reviews?.items.map((one) => one.id)).toEqual(
      Array.from({ length: 11 }, (_, at) => `#${at + 1}`)
    )
    expect(state?.project?.reviews?.items[0]?.tone).toBeUndefined()
    expect(state?.project?.todo).toBeNull()
  })

  it('keeps a long To Do from the host, so the lead can wave past the first in-progress tickets', () => {
    const items = Array.from({ length: 40 }, (_, at) => ({
      id: `CIN-${at}`,
      title: 'x',
      url: `https://jira/CIN-${at}`
    }))
    const state = gameStateOf({
      ...STATE,
      project: { reviews: null, todo: { provider: 'jira', total: 40, url: null, items } }
    })
    expect(state?.project?.todo?.items).toHaveLength(30)
  })

  it('has no project work from a host older than it', () => {
    const { project: _project, ...older } = STATE
    expect(gameStateOf(older)?.project).toBeUndefined()
  })
})

describe('a To Do that runs an action', () => {
  const JIRA = { id: 'action-0', label: 'Jira', command: 'jira', prompt: 'Show my To Do' }
  const withAction = (actionId?: string): GameState => ({
    ...STATE,
    actions: [JIRA],
    project: {
      reviews: null,
      todo: {
        ...(PROJECT.todo as NonNullable<GameProjectWork['todo']>),
        ...(actionId === undefined ? {} : { actionId })
      }
    }
  })

  it('keeps the action Orca names for the To Do', () => {
    const parsed = gameStateOf(withAction('action-0'))
    expect(parsed?.project?.todo?.actionId).toBe('action-0')
    expect(todoActionOf(parsed as GameState)).toEqual(JIRA)
  })

  it('names no action when the one it points at is missing or unset', () => {
    for (const state of [withAction('action-9'), withAction()]) {
      expect(todoActionOf(state)).toBeUndefined()
    }
  })
})

describe('a PR list that runs an action', () => {
  it('keeps the action Orca names for the PR list', () => {
    const PRS = { id: 'action-0', label: 'PRs', command: 'prs', prompt: 'Show my PRs' }
    const reviews = { ...(PROJECT.reviews as NonNullable<GameProjectWork['reviews']>), total: 0 }
    const parsed = gameStateOf({
      ...STATE,
      actions: [PRS],
      project: { reviews: { ...reviews, actionId: 'action-0' }, todo: null }
    }) as GameState
    expect(listActionOf(parsed, 'reviews')).toEqual(PRS)
  })
})

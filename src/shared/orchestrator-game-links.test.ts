import { describe, expect, it } from 'vitest'
import { gameLinksOf } from './orchestrator-game-links'
import type { GameReview, GameWorkItem } from './orchestrator-game-state'

const review: GameReview = {
  provider: 'github',
  number: 42,
  title: 'feat: game',
  url: 'https://github.com/o/r/pull/42',
  state: 'open',
  ci: 'failure'
}

const workItem: GameWorkItem = {
  provider: 'plane',
  identifier: 'ORCA-586',
  title: 'Game links',
  url: 'https://app.plane.so/ws/browse/ORCA-586/',
  status: 'In Review',
  statusGroup: 'review'
}

describe('gameLinksOf', () => {
  it('links the review, its checks and the work item', () => {
    expect(gameLinksOf({ review, workItem })).toEqual([
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
        url: 'https://github.com/o/r/pull/42/checks',
        status: 'failure',
        tone: 'danger'
      },
      {
        id: 'workItem',
        kind: 'workItem',
        provider: 'plane',
        label: 'ORCA-586',
        url: 'https://app.plane.so/ws/browse/ORCA-586/',
        status: 'In Review',
        tone: 'pending'
      }
    ])
  })

  it("links a GitLab merge request's pipelines", () => {
    const links = gameLinksOf({
      review: {
        ...review,
        provider: 'gitlab',
        number: 7,
        url: 'https://gitlab.com/g/p/-/merge_requests/7',
        state: 'merged',
        ci: 'success'
      },
      workItem: null
    })

    expect(links.map((link) => [link.label, link.url, link.tone])).toEqual([
      ['MR !7', 'https://gitlab.com/g/p/-/merge_requests/7', 'success'],
      ['CI', 'https://gitlab.com/g/p/-/merge_requests/7/pipelines', 'success']
    ])
  })

  it('leaves CI out when there are no checks or the provider has no known checks page', () => {
    const none = gameLinksOf({ review: { ...review, ci: 'none' }, workItem: null })
    const bitbucket = gameLinksOf({
      review: {
        ...review,
        provider: 'bitbucket',
        url: 'https://bitbucket.org/o/r/pull-requests/42'
      },
      workItem: null
    })

    expect(none.map((link) => link.id)).toEqual(['review'])
    expect(bitbucket.map((link) => link.id)).toEqual(['review'])
  })

  it('drops a link whose URL is not http(s)', () => {
    const links = gameLinksOf({
      review: null,
      workItem: { ...workItem, url: 'javascript:alert(1)' }
    })

    expect(links).toEqual([])
  })
})

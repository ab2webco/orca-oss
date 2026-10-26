import { describe, expect, it } from 'vitest'

import {
  getGitHubPullRequestReviewFacts,
  reviewFactsOf,
  type PullRequestReviewFacts
} from './pull-request-review-facts'

const response = (pullRequest: unknown) => ({ data: { repository: { pullRequest } } })

const head = (oid: string, state: string | null) => ({
  oid,
  statusCheckRollup: state === null ? null : { state }
})

describe('reviewFactsOf', () => {
  it('reads CI per pushed head, review threads and reopen events', () => {
    expect(
      reviewFactsOf(
        response({
          reviewThreads: { totalCount: 2 },
          reopened: { totalCount: 16, filteredCount: 1 },
          forcePushes: { nodes: [{ beforeCommit: head('aaa', 'FAILURE') }] },
          commits: {
            nodes: [
              { commit: head('bbb', null) },
              { commit: head('ccc', 'ERROR') },
              { commit: head('ddd', 'PENDING') },
              { commit: head('eee', 'SUCCESS') }
            ]
          }
        })
      )
    ).toEqual({
      ciHistory: [
        { headSha: 'aaa', ci: 'failure' },
        { headSha: 'ccc', ci: 'failure' },
        { headSha: 'ddd', ci: 'pending' },
        { headSha: 'eee', ci: 'success' }
      ],
      commentCount: 2,
      reopenCount: 1
    })
  })

  // Why: GitHub's totalCount ignores itemTypes; #652 reports 5 there with no reopen at all.
  it('counts reopen events with filteredCount, never the unfiltered totalCount', () => {
    const facts = reviewFactsOf(
      response({
        reviewThreads: { totalCount: 0 },
        reopened: { totalCount: 5, filteredCount: 0 },
        forcePushes: { nodes: [] },
        commits: { nodes: [{ commit: head('aaa', 'SUCCESS') }] }
      })
    )

    expect(facts?.reopenCount).toBe(0)
  })

  it('keeps one entry per head when a force-pushed head is still in the commit list', () => {
    const facts = reviewFactsOf(
      response({
        reviewThreads: { totalCount: 0 },
        reopened: { totalCount: 1, filteredCount: 0 },
        forcePushes: { nodes: [{ beforeCommit: head('aaa', 'FAILURE') }, { beforeCommit: null }] },
        commits: { nodes: [{ commit: head('aaa', 'FAILURE') }, { commit: head('bbb', 'SUCCESS') }] }
      })
    )

    expect(facts?.ciHistory).toEqual([
      { headSha: 'aaa', ci: 'failure' },
      { headSha: 'bbb', ci: 'success' }
    ])
  })

  it('has no facts when the pull request or one of its counts is missing', () => {
    expect(reviewFactsOf(response(null))).toBeNull()
    expect(reviewFactsOf({ errors: [{ message: 'rate limited' }] })).toBeNull()
    expect(
      reviewFactsOf(
        response({
          reviewThreads: { totalCount: 0 },
          forcePushes: { nodes: [] },
          commits: { nodes: [] }
        })
      )
    ).toBeNull()
  })
})

describe('getGitHubPullRequestReviewFacts', () => {
  const repository = { owner: 'o', repo: 'r' }
  const clean: PullRequestReviewFacts = { ciHistory: [], commentCount: 0, reopenCount: 0 }

  const reader = (value: PullRequestReviewFacts | null) => {
    const reads: number[] = []
    return {
      reads,
      readFacts: async (_repository: unknown, number: number) => {
        reads.push(number)
        return value
      }
    }
  }

  it('reads a pull request once per version and again when it changes', async () => {
    const { reads, readFacts } = reader(clean)
    const read = (version: string) =>
      getGitHubPullRequestReviewFacts(
        { repository, number: 101, version, ghOptions: {} },
        { readFacts }
      )

    expect(await read('v1')).toEqual(clean)
    expect(await read('v1')).toEqual(clean)
    expect(reads).toEqual([101])

    await read('v2')
    expect(reads).toEqual([101, 101])
  })

  it('shares one read between polls that ask at the same time', async () => {
    const { reads, readFacts } = reader(clean)
    const read = () =>
      getGitHubPullRequestReviewFacts(
        { repository, number: 102, version: 'v1', ghOptions: {} },
        { readFacts }
      )

    await Promise.all([read(), read(), read()])

    expect(reads).toEqual([102])
  })

  it('retries a failed read only after a short wait', async () => {
    const { reads, readFacts } = reader(null)
    let now = 1_000
    const read = () =>
      getGitHubPullRequestReviewFacts(
        { repository, number: 103, version: 'v1', ghOptions: {} },
        { readFacts, now: () => now }
      )

    expect(await read()).toBeNull()
    expect(await read()).toBeNull()
    expect(reads).toEqual([103])

    now += 61_000
    await read()
    expect(reads).toEqual([103, 103])
  })
})

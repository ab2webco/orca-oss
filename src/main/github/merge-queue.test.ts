import { describe, expect, it } from 'vitest'
import { mergeQueueDepartureOfResponse, mergeQueueOfResponse } from './merge-queue'

const entry = (position: number, state: string, number: number | null = position) => ({
  position,
  state,
  enqueuedAt: '2026-11-06T09:21:30Z',
  pullRequest: number === null ? null : { number, title: `PR ${number}`, url: `u/${number}` }
})

const response = (mergeQueue: unknown): string =>
  JSON.stringify({ data: { repository: { mergeQueue } } })

describe('mergeQueueOfResponse', () => {
  it('reads null when the branch has no merge queue', () => {
    expect(mergeQueueOfResponse(response(null))).toBeNull()
  })

  it('reads an empty queue as no entries, not as no queue', () => {
    expect(mergeQueueOfResponse(response({ entries: { nodes: [] } }))).toEqual([])
  })

  it('maps each entry to the provider-neutral shape, in position order', () => {
    const stdout = response({
      entries: { nodes: [entry(2, 'QUEUED'), entry(1, 'AWAITING_CHECKS')] }
    })

    expect(mergeQueueOfResponse(stdout)).toEqual([
      {
        id: '#1',
        title: 'PR 1',
        url: 'u/1',
        position: 1,
        state: 'checks',
        since: Date.parse('2026-11-06T09:21:30Z')
      },
      {
        id: '#2',
        title: 'PR 2',
        url: 'u/2',
        position: 2,
        state: 'waiting',
        since: Date.parse('2026-11-06T09:21:30Z')
      }
    ])
  })

  it.each([
    ['AWAITING_CHECKS', 'checks'],
    ['LOCKED', 'checks'],
    ['MERGEABLE', 'checks'],
    ['QUEUED', 'waiting'],
    ['UNMERGEABLE', 'failed'],
    ['SOMETHING_NEW', 'waiting']
  ])('reads %s as %s', (state, expected) => {
    const [read] = mergeQueueOfResponse(response({ entries: { nodes: [entry(1, state)] } })) ?? []

    expect(read?.state).toBe(expected)
  })

  it('skips an entry whose PR GitHub did not return', () => {
    const stdout = response({ entries: { nodes: [entry(1, 'QUEUED', null), entry(2, 'QUEUED')] } })

    expect(mergeQueueOfResponse(stdout)?.map((one) => one.id)).toEqual(['#2'])
  })

  it('leaves `since` unknown on a date it cannot read', () => {
    const stdout = response({
      entries: { nodes: [{ ...entry(1, 'QUEUED'), enqueuedAt: 'not a date' }] }
    })

    expect(mergeQueueOfResponse(stdout)?.[0]?.since).toBeNull()
  })
})

describe('mergeQueueDepartureOfResponse (ORCA-1273)', () => {
  const departure = (pullRequest: unknown): string =>
    JSON.stringify({ data: { repository: { pullRequest } } })

  it("reads the PR's state and its last removal's reason and actor", () => {
    const nodes = [
      { reason: 'failed_checks', actor: { login: 'github-merge-queue' } },
      { reason: 'merged', actor: { login: 'github-merge-queue' } }
    ]
    expect(
      mergeQueueDepartureOfResponse(departure({ state: 'MERGED', timelineItems: { nodes } }))
    ).toEqual({ state: 'merged', reason: 'merged', actor: 'github-merge-queue' })
  })

  it('keeps the state when no removal is on the timeline, and is null for no PR', () => {
    expect(
      mergeQueueDepartureOfResponse(departure({ state: 'OPEN', timelineItems: { nodes: [] } }))
    ).toEqual({ state: 'open', reason: null, actor: null })
    expect(mergeQueueDepartureOfResponse(departure(null))).toBeNull()
  })

  it('names the failed checks of the merge-group commit, latest run of each check only', () => {
    const check = (name: string, conclusion: string, runId: number) => ({
      name,
      status: 'COMPLETED',
      conclusion,
      checkSuite: { workflowRun: { databaseId: runId, workflow: { name: 'PR Checks' } } }
    })
    const beforeCommit = {
      statusCheckRollup: {
        contexts: {
          nodes: [
            check('typecheck', 'SUCCESS', 9),
            check('e2e 6-of-16', 'FAILURE', 9),
            check('verify', 'FAILURE', 9),
            check('lint', 'FAILURE', 8),
            check('lint', 'SUCCESS', 9),
            { context: 'ci/legacy', state: 'ERROR' },
            {}
          ]
        }
      }
    }
    const nodes = [
      { reason: 'failed_checks', actor: { login: 'github-merge-queue' }, beforeCommit }
    ]
    expect(
      mergeQueueDepartureOfResponse(departure({ state: 'OPEN', timelineItems: { nodes } }))
    ).toEqual({
      state: 'open',
      reason: 'failed_checks',
      actor: 'github-merge-queue',
      failedChecks: [
        { name: 'e2e 6-of-16', runId: 9 },
        { name: 'verify', runId: 9 },
        { name: 'ci/legacy', runId: null }
      ]
    })
  })
})

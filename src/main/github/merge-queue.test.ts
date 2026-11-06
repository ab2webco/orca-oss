import { describe, expect, it } from 'vitest'
import { mergeQueueOfResponse } from './merge-queue'

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

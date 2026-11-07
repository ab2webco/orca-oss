import { describe, expect, it } from 'vitest'
import { mergeableOfResponse, mergeableQueryOf } from './pull-request-mergeable'

describe('mergeableQueryOf', () => {
  it('aliases each PR so one call reads them all', () => {
    const query = mergeableQueryOf([12, 34])

    expect(query).toContain('pr12: pullRequest(number: 12) { mergeable }')
    expect(query).toContain('pr34: pullRequest(number: 34) { mergeable }')
  })

  it('never builds a query from something that is not a PR number', () => {
    expect(() => mergeableQueryOf([1.5])).toThrow()
    expect(() => mergeableQueryOf([-1])).toThrow()
  })
})

describe('mergeableOfResponse', () => {
  it('reads each PR by its number', () => {
    const stdout = JSON.stringify({
      data: {
        repository: {
          pr12: { mergeable: 'CONFLICTING' },
          pr34: { mergeable: 'MERGEABLE' },
          pr56: { mergeable: 'UNKNOWN' }
        }
      }
    })

    expect([...mergeableOfResponse(stdout, [12, 34, 56])]).toEqual([
      [12, 'CONFLICTING'],
      [34, 'MERGEABLE'],
      [56, 'UNKNOWN']
    ])
  })

  it('drops a PR GitHub did not return, or a value it does not know', () => {
    const stdout = JSON.stringify({
      data: { repository: { pr12: null, pr34: { mergeable: 'SOMETHING_NEW' } } }
    })

    expect([...mergeableOfResponse(stdout, [12, 34, 56])]).toEqual([])
  })

  it('reads nothing from a response with no repository', () => {
    expect([...mergeableOfResponse(JSON.stringify({ data: {} }), [12])]).toEqual([])
  })
})

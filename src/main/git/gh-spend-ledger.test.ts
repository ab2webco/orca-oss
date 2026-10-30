import { afterEach, describe, expect, it } from 'vitest'
import { _resetGhSpendLedger, ghCommandShape, ghSpendSince, recordGhSpend } from './gh-spend-ledger'

afterEach(() => {
  _resetGhSpendLedger()
})

describe('ghCommandShape', () => {
  it('names a gh subcommand by its noun and verb, without ids or flags', () => {
    expect(ghCommandShape(['pr', 'view', '757', '--json', 'state', '-R', 'a/b'])).toBe('pr view')
    expect(ghCommandShape(['pr', 'checks', '7'])).toBe('pr checks')
  })

  it('names a REST call by its path with owner, repo, numbers and refs blanked', () => {
    expect(
      ghCommandShape([
        'api',
        '--hostname',
        'github.com',
        'repos/acme/widgets/commits/0123456789abcdef0123456789abcdef01234567/check-runs?per_page=100'
      ])
    ).toBe('api repos/:owner/:repo/commits/:ref/check-runs')
    expect(ghCommandShape(['api', '--paginate', 'repos/a/b/pulls/12/files'])).toBe(
      'api repos/:owner/:repo/pulls/:n/files'
    )
  })

  it('marks a call gh may answer from its disk cache', () => {
    expect(ghCommandShape(['api', '--cache', '60s', 'repos/a/b/pulls/3'])).toBe(
      'api repos/:owner/:repo/pulls/:n (cache)'
    )
  })

  it('names a GraphQL call by its operation when the query has one', () => {
    expect(
      ghCommandShape(['api', 'graphql', '-f', 'query=query PullRequestReviewFacts($n: Int!) { x }'])
    ).toBe('api graphql PullRequestReviewFacts')
    expect(ghCommandShape(['api', 'graphql', '-f', 'query={ viewer { login } }'])).toBe(
      'api graphql'
    )
  })
})

describe('ghSpendSince', () => {
  it('counts calls per bucket and lists the busiest shapes first', () => {
    recordGhSpend(['pr', 'view', '1'], 'graphql', 1_000)
    recordGhSpend(['pr', 'checks', '1'], 'graphql', 2_000)
    recordGhSpend(['pr', 'checks', '2'], 'graphql', 3_000)
    recordGhSpend(['api', 'repos/a/b/pulls/1'], 'core', 4_000)

    expect(ghSpendSince(0, 5_000)).toEqual({
      calls: { core: 1, graphql: 3, search: 0 },
      top: [
        { shape: 'pr checks', bucket: 'graphql', calls: 2 },
        { shape: 'api repos/:owner/:repo/pulls/:n', bucket: 'core', calls: 1 },
        { shape: 'pr view', bucket: 'graphql', calls: 1 }
      ]
    })
  })

  it('leaves out calls before the window start', () => {
    recordGhSpend(['pr', 'view', '1'], 'graphql', 1_000)
    recordGhSpend(['pr', 'view', '1'], 'graphql', 9_000)

    expect(ghSpendSince(5_000, 10_000).calls.graphql).toBe(1)
  })

  it('forgets calls older than an hour', () => {
    recordGhSpend(['pr', 'view', '1'], 'graphql', 0)
    recordGhSpend(['pr', 'view', '1'], 'graphql', 3_700_000)

    expect(ghSpendSince(0, 3_700_000).calls.graphql).toBe(1)
  })
})

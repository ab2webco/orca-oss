import { describe, expect, it } from 'vitest'
import { selectPullRequestDiffBase } from './git-pull-request-diff-base.mjs'

describe('pull request diff base selection', () => {
  it('uses the merge commit first parent for pull request checkouts', () => {
    expect(
      selectPullRequestDiffBase('event-base', ['current-base', 'pull-request-head'], 'pull_request')
    ).toBe('current-base')
  })

  it('keeps the requested base outside synthetic pull request merges', () => {
    expect(selectPullRequestDiffBase('requested-base', ['parent'], 'pull_request')).toBe(
      'requested-base'
    )
    expect(selectPullRequestDiffBase('requested-base', ['parent', 'other'], 'push')).toBe(
      'requested-base'
    )
  })

  it('widens to the sync base a sync-aware caller derives from the first parent', () => {
    expect(
      selectPullRequestDiffBase(
        'event-base',
        ['current-base', 'pull-request-head'],
        'pull_request',
        () => 'upstream-frontier'
      )
    ).toBe('upstream-frontier')
  })

  it('hands the sync resolver the checkout base, never the requested one', () => {
    const seen = []
    selectPullRequestDiffBase(
      'event-base',
      ['current-base', 'pull-request-head'],
      'pull_request',
      (candidate) => {
        seen.push(candidate)
        return null
      }
    )
    expect(seen).toEqual(['current-base'])
  })

  it('falls back to the first parent when the sync resolver declines', () => {
    expect(
      selectPullRequestDiffBase(
        'event-base',
        ['current-base', 'pull-request-head'],
        'pull_request',
        () => null
      )
    ).toBe('current-base')
  })

  it('never consults the sync resolver outside a synthetic pull request merge', () => {
    let called = false
    const resolver = () => {
      called = true
      return 'upstream-frontier'
    }
    expect(selectPullRequestDiffBase('requested-base', ['parent'], 'pull_request', resolver)).toBe(
      'requested-base'
    )
    expect(selectPullRequestDiffBase('requested-base', ['parent', 'other'], 'push', resolver)).toBe(
      'requested-base'
    )
    expect(called).toBe(false)
  })
})

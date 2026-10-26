import { describe, expect, it } from 'vitest'

import type { HostedReviewInfo } from '../../shared/hosted-review'
import type { PullRequestReviewFacts } from '../github/pull-request-review-facts'
import { withGameReviewFacts } from './orchestrator-game-review-facts'

const github: HostedReviewInfo = {
  provider: 'github',
  number: 652,
  title: 'Game',
  state: 'merged',
  url: 'https://github.com/o/r/pull/652',
  status: 'success',
  updatedAt: '2026-10-25T20:29:25Z',
  mergeable: 'UNKNOWN',
  headSha: 'bbb',
  githubRepository: { owner: 'o', repo: 'r' }
}

const facts: PullRequestReviewFacts = {
  ciHistory: [{ headSha: 'bbb', ci: 'success' }],
  commentCount: 0,
  reopenCount: 0
}

const reader = (value: PullRequestReviewFacts | null) => {
  const asked: { number: number; version: string; scope: string | undefined }[] = []
  return {
    asked,
    read: async (args: { number: number; version: string; executionScope?: string }) => {
      asked.push({ number: args.number, version: args.version, scope: args.executionScope })
      return value
    }
  }
}

describe('withGameReviewFacts', () => {
  it('adds the facts to a GitHub review, read once per PR version', async () => {
    const { asked, read } = reader(facts)

    expect(await withGameReviewFacts(github, { path: '/repo' }, read)).toEqual({
      ...github,
      ...facts
    })
    expect(asked).toEqual([
      { number: 652, version: '2026-10-25T20:29:25Z|bbb|success', scope: 'local' }
    ])
  })

  it('keeps a review without facts when the provider or repository cannot be read', async () => {
    const { asked, read } = reader(facts)
    const gitlab: HostedReviewInfo = { ...github, provider: 'gitlab' }
    const { githubRepository: _repository, ...unknownRepo } = github

    expect(await withGameReviewFacts(gitlab, { path: '/repo' }, read)).toEqual(gitlab)
    expect(await withGameReviewFacts(unknownRepo, { path: '/repo' }, read)).toEqual(unknownRepo)
    expect(await withGameReviewFacts(null, { path: '/repo' }, read)).toBeNull()
    expect(asked).toEqual([])
  })

  it('keeps the review as it was when the facts read fails', async () => {
    const { read } = reader(null)

    expect(
      await withGameReviewFacts(github, { path: '/repo', connectionId: 'ssh-1' }, read)
    ).toEqual(github)
  })
})

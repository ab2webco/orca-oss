import { describe, expect, it } from 'vitest'
import { repositoryTargetWorktreeOf } from './repository-target-worktree'

const repo = { id: 'repo1', path: '/repo' }
const main = { id: 'repo1::/repo', path: '/repo', isMainWorktree: true }
const feature = { id: 'repo1::/wt/feature', path: '/wt/feature', isMainWorktree: false }

describe('repositoryTargetWorktreeOf', () => {
  it("prefers the active worktree when it belongs to this repo, else the repo's main one", () => {
    expect(repositoryTargetWorktreeOf(feature.id, repo, [main, feature])).toEqual({
      id: feature.id,
      path: feature.path
    })
    expect(repositoryTargetWorktreeOf('other::/x', repo, [feature, main])).toEqual({
      id: main.id,
      path: main.path
    })
  })

  it('falls back to the repo root when no worktree is known yet', () => {
    expect(repositoryTargetWorktreeOf(null, repo, [])).toEqual({
      id: 'repo1::/repo',
      path: '/repo'
    })
    expect(repositoryTargetWorktreeOf('repo1::/gone', repo, [])).toEqual({
      id: 'repo1::/gone',
      path: '/repo'
    })
  })
})

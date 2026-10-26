import { describe, expect, it } from 'vitest'
import { ORCA_WORKTREE_SLUG_ENV, worktreeSlugEnv, worktreeSlugOf } from './slug'

describe('worktreeSlugOf', () => {
  it('names the worktree by its directory and a hash of its identity', () => {
    const slug = worktreeSlugOf('repo-1::/home/me/orca/My-Feature.v2')
    expect(slug).toMatch(/^my_feature_v2_[0-9a-f]{8}$/)
  })

  it('is stable for one worktree id', () => {
    const id = 'repo-1::/home/me/orca/feature'
    expect(worktreeSlugOf(id)).toBe(worktreeSlugOf(id))
  })

  it('differs between sibling worktrees and same-named worktrees of other repos', () => {
    const a = worktreeSlugOf('repo-1::/w/orca/feature-a')
    const b = worktreeSlugOf('repo-1::/w/orca/feature-b')
    const otherRepo = worktreeSlugOf('repo-2::/w/other/feature-a')
    expect(new Set([a, b, otherRepo]).size).toBe(3)
  })

  it('handles Windows paths and trailing separators', () => {
    expect(worktreeSlugOf('repo::C:\\Users\\me\\proj\\feat\\')).toMatch(/^feat_[0-9a-f]{8}$/)
  })

  it('bounds the length so the slug fits database identifiers', () => {
    const slug = worktreeSlugOf(`repo::/w/${'x'.repeat(200)}`)
    expect(slug.length).toBeLessThanOrEqual(49)
    expect(slug).toMatch(/^[a-z0-9_]+$/)
  })

  it('gives folder workspaces a slug from their workspace key', () => {
    const slug = worktreeSlugOf('folder:5b0c7c64-8f0e-4a51-9a49-0c6f2f3b1d2e')
    expect(slug).toMatch(/^folder_[0-9a-f]{8}$/)
  })

  it('falls back to a hash-only name when the path has no usable characters', () => {
    expect(worktreeSlugOf('repo::/w/日本')).toMatch(/^worktree_[0-9a-f]{8}$/)
  })
})

describe('worktreeSlugEnv', () => {
  it('returns the env entry for one worktree', () => {
    const id = 'repo::/w/feat'
    expect(worktreeSlugEnv(id)).toEqual({ [ORCA_WORKTREE_SLUG_ENV]: worktreeSlugOf(id) })
    expect(ORCA_WORKTREE_SLUG_ENV).toBe('ORCA_WORKTREE_SLUG')
  })
})

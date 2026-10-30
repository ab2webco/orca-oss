import { describe, expect, it } from 'vitest'
import { isGameMemberWorktreeGone } from './game-member-worktree-presence'
import type { Repo } from '../../shared/repo-types'
import type { RuntimeWorktreeScanResult } from './repo-worktree-resolution-scan'

const repo = (id: string, extra: Partial<Repo> = {}): Repo =>
  ({ id, path: `/r/${id}`, ...extra }) as Repo

const worktree = (path: string) => ({
  path,
  head: 'abc',
  branch: 'b',
  isBare: false,
  isMainWorktree: false
})

function deps(repos: Repo[], scan: RuntimeWorktreeScanResult) {
  return {
    reposWithId: (id: string) => repos.filter((one) => one.id === id),
    scan: async () => scan
  }
}

describe('isGameMemberWorktreeGone (ORCA-832)', () => {
  it('is gone when its repo answered without it', async () => {
    const result = await isGameMemberWorktreeGone(
      'repo1::/w/orca-681',
      deps([repo('repo1')], { ok: true, worktrees: [worktree('/w/orca-682')] })
    )
    expect(result).toBe(true)
  })

  it('is present when its repo still lists it', async () => {
    const result = await isGameMemberWorktreeGone(
      'repo1::/w/orca-681',
      deps([repo('repo1')], { ok: true, worktrees: [worktree('/w/orca-681')] })
    )
    expect(result).toBe(false)
  })

  it('is not gone when the repo could not be scanned, as with an SSH host offline', async () => {
    const result = await isGameMemberWorktreeGone(
      'repo1::/w/orca-681',
      deps([repo('repo1')], { ok: false, worktrees: [] })
    )
    expect(result).toBe(false)
  })

  it('is gone when its repo is no longer in Orca', async () => {
    const result = await isGameMemberWorktreeGone(
      'repo1::/w/orca-681',
      deps([], { ok: true, worktrees: [] })
    )
    expect(result).toBe(true)
  })

  it('never judges a folder workspace or an id it cannot parse', async () => {
    const folder = deps([repo('repo1', { kind: 'folder' } as Partial<Repo>)], {
      ok: true,
      worktrees: []
    })
    expect(await isGameMemberWorktreeGone('repo1::/w/f', folder)).toBe(false)
    expect(await isGameMemberWorktreeGone('no-separator', folder)).toBe(false)
  })
})

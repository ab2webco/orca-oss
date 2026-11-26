import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'

const dirs: string[] = []
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })))

const BRANCH = 'test/cin-1887-sandbox-payments'
const review = (number: number, state: 'open' | 'closed') => ({
  provider: 'github' as const,
  number,
  title: `PR ${number}`,
  url: `https://github.com/acme/app/pull/${number}`,
  state,
  status: state === 'open' ? ('pending' as const) : ('failure' as const),
  updatedAt: '2026-11-25T15:50:00Z'
})

// Why: worktree.ps names the branch's PR from the renderer's cache, here still the closed #1179.
function memberHost() {
  const runtime = new OrcaRuntimeService(null)
  const path = mkdtempSync(join(tmpdir(), 'orca-game-review-'))
  dirs.push(path)
  const worktree = { id: `repo-cin::${path}`, repoId: 'repo-cin', path, branch: BRANCH }
  vi.spyOn(
    runtime as unknown as { getResolvedWorktreeMap: () => Promise<unknown> },
    'getResolvedWorktreeMap'
  ).mockResolvedValue(new Map([[worktree.id, worktree]]))
  vi.spyOn(runtime, 'getWorktreePs').mockResolvedValue({
    worktrees: [
      {
        worktreeId: worktree.id,
        branch: BRANCH,
        linkedPR: { number: 1179, state: 'closed' },
        agents: []
      }
    ]
  } as never)
  vi.spyOn(runtime, 'resolveRepoSelector').mockResolvedValue({
    id: 'repo-cin',
    path
  } as never)
  const hosted = vi
    .spyOn(runtime, 'getHostedReviewForBranch')
    .mockImplementation(async (args) =>
      args.linkedGitHubPR === 1179 ? review(1179, 'closed') : review(1266, 'open')
    )
  return { runtime, hosted, worktreeId: worktree.id }
}

describe("game state's review is the branch's open PR (ORCA-1435)", () => {
  it('reads the branch first, though worktree.ps still names the closed PR', async () => {
    const { runtime, hosted, worktreeId } = memberHost()

    const state = await runtime.getOrchestratorGameState({ worktreeId })

    expect(state.review).toMatchObject({ number: 1266, state: 'open' })
    expect(hosted).not.toHaveBeenCalledWith(expect.objectContaining({ linkedGitHubPR: 1179 }))
  })

  it('keeps the open PR while GitHub answers 502, instead of the closed one or nothing', async () => {
    const { runtime, hosted, worktreeId } = memberHost()
    await runtime.getOrchestratorGameState({ worktreeId })
    hosted.mockRejectedValue(new Error('GitHub PR lookup failed (server_error): HTTP 502'))

    const state = await runtime.getOrchestratorGameState({ worktreeId })

    expect(state.review).toMatchObject({ number: 1266, state: 'open' })
  })
})

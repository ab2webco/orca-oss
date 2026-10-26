import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type { PRReviewDecision } from '../../shared/github/pull-request-types'
import { buildOrchestratorGameState } from './orchestrator-game-state-builder'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

const none = async () => null

const stateWithDecision = (reviewDecision: PRReviewDecision | null) => {
  const path = mkdtempSync(join(tmpdir(), 'orca-game-verdict-'))
  dirs.push(path)
  return buildOrchestratorGameState({
    settings: {},
    worktree: {
      id: 'wt1',
      repoId: 'repo1',
      path,
      branch: 'feat/game',
      displayName: 'Game',
      linkedWorkItem: null
    },
    agents: [],
    leaderPaneKey: null,
    readReview: async () => ({
      provider: 'github',
      number: 12,
      title: 'Game',
      url: 'https://github.com/o/r/pull/12',
      state: 'open',
      status: 'failure',
      reviewDecision
    }),
    readPlane: none,
    readLinear: none
  })
}

describe('The review verdict in the state the mod reads', () => {
  it("carries the PR's review decision as a verdict", async () => {
    const state = await stateWithDecision('CHANGES_REQUESTED')

    expect(state.review).toMatchObject({ number: 12, ci: 'failure', verdict: 'changes_requested' })
  })

  it('leaves the verdict out while the PR has no decision yet', async () => {
    const state = await stateWithDecision(null)

    expect(state.review).not.toHaveProperty('verdict')
  })
})

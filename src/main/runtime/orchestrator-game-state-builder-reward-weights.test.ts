import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { DEFAULT_GAME_REWARD_WEIGHTS } from '../../shared/orchestrator-game-reward-weights'
import { buildOrchestratorGameState } from './orchestrator-game-state-builder'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

const none = async () => null

const stateIn = (orcaYaml: string | null, local?: Record<string, number>) => {
  const path = mkdtempSync(join(tmpdir(), 'orca-game-weights-'))
  dirs.push(path)
  if (orcaYaml !== null) {
    writeFileSync(join(path, 'orca.yaml'), orcaYaml)
  }
  return buildOrchestratorGameState({
    settings: local ? { orchestratorGameProjects: { repo1: { rewardWeights: local } } } : {},
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
    readReview: none,
    readPlane: none,
    readLinear: none
  })
}

describe('Reward weights in the state the mod reads', () => {
  it('hands the baseline table when no layer tunes it', async () => {
    expect((await stateIn(null)).rewardWeights).toEqual(DEFAULT_GAME_REWARD_WEIGHTS)
  })

  it("hands orca.yaml's weights under the dev's local ones and warns about a bad value", async () => {
    const state = await stateIn(
      [
        'orchestratorGame:',
        '  rewardWeights:',
        '    ci-green: 5',
        '    member-claimed: 0',
        '    work-item-done: lots'
      ].join('\n'),
      { 'ci-green': 8 }
    )

    expect(state.rewardWeights).toEqual({
      ...DEFAULT_GAME_REWARD_WEIGHTS,
      'ci-green': 8,
      'member-claimed': 0
    })
    expect(state.warnings).toContain(
      'orchestratorGame.rewardWeights.work-item-done must be a whole number from 0 to 1000'
    )
  })
})

import { describe, expect, it } from 'vitest'

import { buildOrchestratorGameState } from './orchestrator-game-state-builder'

const none = async () => null

const stateWith = (repoId: string | null, suggestedView?: '2d-hd') =>
  buildOrchestratorGameState({
    settings: {},
    worktree: {
      id: 'w1',
      repoId,
      connectionId: null,
      path: '/nonexistent/orca-689-view',
      branch: 'main',
      displayName: 'w',
      linkedWorkItem: null
    },
    agents: [],
    leaderPaneKey: null,
    readReview: none,
    readPlane: none,
    readLinear: none,
    suggestedView: async () => suggestedView
  })

describe('what the view switcher reads from the game state', () => {
  it('offers this project and every project, with the suggested view', async () => {
    const state = await stateWith('r1', '2d-hd')

    expect(state.viewScopes).toEqual(['project', 'global'])
    expect(state.suggestedView).toBe('2d-hd')
  })

  it('offers every project only when the worktree has no repo, and no flag without a signal', async () => {
    const state = await stateWith(null)

    expect(state.viewScopes).toEqual(['global'])
    expect(state).not.toHaveProperty('suggestedView')
  })
})

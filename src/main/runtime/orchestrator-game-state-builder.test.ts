import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildOrchestratorGameState } from './orchestrator-game-state-builder'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function checkout(orcaYaml?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'orca-game-state-'))
  dirs.push(dir)
  if (orcaYaml) {
    writeFileSync(join(dir, 'orca.yaml'), orcaYaml)
  }
  return dir
}

const none = async () => null

function worktree(path: string) {
  return {
    id: 'wt1',
    repoId: 'repo1',
    path,
    branch: 'feat/game',
    displayName: 'Game',
    linkedWorkItem: null
  }
}

describe('buildOrchestratorGameState', () => {
  it('collects config, fleet, review and the Plane work item', async () => {
    const state = await buildOrchestratorGameState({
      settings: { orchestratorGame: { hud: false } },
      worktree: worktree(checkout('orchestratorGame:\n  mode: zen\n  scene: 7\n')),
      agents: [
        {
          paneKey: 'tab:a',
          state: 'working',
          agentType: 'claude',
          displayName: null,
          taskTitle: null,
          toolName: 'Edit'
        }
      ],
      leaderPaneKey: 'tab:a',
      readReview: async () => ({
        provider: 'github',
        number: 12,
        title: 'Game',
        url: 'https://github.com/o/r/pull/12',
        state: 'open',
        status: 'success'
      }),
      readPlane: async () => ({
        identifier: 'ORCA-580',
        title: 'Orchestrator game',
        url: 'https://plane.example/ORCA-580',
        stateName: 'In Review',
        stateGroup: 'started'
      }),
      readLinear: none
    })

    expect(state.config).toMatchObject({ mode: 'zen', hud: false })
    expect(state.sources).toMatchObject({ mode: 'project', hud: 'global' })
    expect(state.warnings).toEqual(['orchestratorGame.scene must be a non-empty scene id'])
    expect(state.agents).toEqual([
      {
        paneKey: 'tab:a',
        displayName: null,
        agentType: 'claude',
        state: 'working',
        toolName: 'Edit',
        isLeader: true
      }
    ])
    expect(state.review?.ci).toBe('success')
    expect(state.workItem).toEqual({
      provider: 'plane',
      identifier: 'ORCA-580',
      title: 'Orchestrator game',
      url: 'https://plane.example/ORCA-580',
      status: 'In Review',
      statusGroup: 'review'
    })
  })

  it('falls back to a linked item without status when no tracker answers', async () => {
    const state = await buildOrchestratorGameState({
      settings: undefined,
      worktree: {
        ...worktree(checkout()),
        linkedWorkItem: {
          provider: 'jira',
          type: 'issue',
          number: 0,
          title: 'Checkout flow',
          url: 'https://jira.example/browse/CIN-9',
          jiraIdentifier: 'CIN-9'
        }
      },
      agents: [],
      leaderPaneKey: null,
      readReview: async () => {
        throw new Error('gh not authenticated')
      },
      readPlane: async () => {
        throw new Error('plane offline')
      },
      readLinear: none
    })

    expect(state.review).toBeNull()
    expect(state.workItem).toEqual({
      provider: 'jira',
      identifier: 'CIN-9',
      title: 'Checkout flow',
      url: 'https://jira.example/browse/CIN-9',
      status: '',
      statusGroup: 'unknown'
    })
  })

  it('leaves the work item out when the project turns the tracker off', async () => {
    const state = await buildOrchestratorGameState({
      settings: undefined,
      worktree: worktree(checkout('orchestratorGame:\n  tracker: false\n')),
      agents: [],
      leaderPaneKey: null,
      readReview: none,
      readPlane: async () => ({
        identifier: 'ORCA-1',
        title: 'x',
        url: '',
        stateName: 'Todo',
        stateGroup: 'unstarted'
      }),
      readLinear: none
    })

    expect(state.workItem).toBeNull()
  })

  it('answers with defaults outside a worktree', async () => {
    const state = await buildOrchestratorGameState({
      settings: undefined,
      worktree: null,
      agents: [],
      leaderPaneKey: null,
      readReview: none,
      readPlane: none,
      readLinear: none
    })

    expect(state.worktree).toBeNull()
    expect(state.config.mode).toBe('on')
  })
})

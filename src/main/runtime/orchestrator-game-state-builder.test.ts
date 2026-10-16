import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { sceneFile } from '../../shared/__fixtures__/orchestrator-game-scene'
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

  it('reads the live status of a linked Jira issue', async () => {
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
      readReview: none,
      readPlane: none,
      readLinear: none,
      readLinkedStatus: async (linked) =>
        linked.jiraIdentifier === 'CIN-9' ? { name: 'QA', group: 'review' } : null
    })

    expect(state.workItem).toMatchObject({
      identifier: 'CIN-9',
      status: 'QA',
      statusGroup: 'review'
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
    expect(state.extensions).toEqual({ scenes: [] })
  })

  it('serves contributed scenes namespaced by plugin and warns about the ones it drops', async () => {
    const state = await buildOrchestratorGameState({
      settings: undefined,
      worktree: worktree(checkout('orchestratorGame:\n  scene: acme.space/orbit\n')),
      agents: [],
      leaderPaneKey: null,
      readReview: none,
      readPlane: none,
      readLinear: none,
      readScenes: async () => [
        { pluginId: 'acme.space', id: 'orbit', text: JSON.stringify(sceneFile()) },
        { pluginId: 'acme.space', id: 'flat', text: JSON.stringify(sceneFile({ band: {} })) }
      ]
    })

    expect(state.config.scene).toBe('acme.space/orbit')
    expect(state.extensions?.scenes.map((one) => [one.id, one.pluginId])).toEqual([
      ['acme.space/orbit', 'acme.space']
    ])
    expect(state.extensions?.scenes[0]?.definition.id).toBe('acme.space/orbit')
    expect(state.warnings).toEqual([expect.stringContaining('game scene acme.space/flat dropped')])
  })

  it('keeps the rest of the state when reading scenes fails', async () => {
    const state = await buildOrchestratorGameState({
      settings: undefined,
      worktree: null,
      agents: [],
      leaderPaneKey: null,
      readReview: none,
      readPlane: none,
      readLinear: none,
      readScenes: async () => {
        throw new Error('plugin service gone')
      }
    })

    expect(state.extensions).toEqual({ scenes: [] })
    expect(state.config.mode).toBe('on')
  })
})

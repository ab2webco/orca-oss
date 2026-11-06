import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type { Repo, Worktree } from '../../../../shared/types'
import { teamSoloSessionsOf, type TeamSoloSessionsState } from './team-panel-solo-sessions'
import { teamPanelSoloModelFrom } from './use-team-panel-solo-model'

const repo = { id: 'repo-1', path: '/r', displayName: 'orca-oss' } as Repo

function worktree(overrides: Partial<Worktree>): Worktree {
  return {
    id: 'repo-1::/r/wt',
    repoId: 'repo-1',
    path: '/r/wt',
    displayName: 'fix-tooltip',
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isMainWorktree: false,
    branch: 'refs/heads/fix-tooltip',
    head: 'abc',
    ...overrides
  } as Worktree
}

function entry(overrides: Partial<AgentStatusEntry>): AgentStatusEntry {
  return {
    state: 'working',
    prompt: 'Fix the tooltip',
    updatedAt: 1,
    stateStartedAt: 1,
    agentType: 'claude',
    model: 'claude-sonnet-5-5',
    paneKey: 'tab-1:11111111-1111-4111-8111-111111111111',
    worktreeId: 'repo-1::/r/wt',
    stateHistory: [],
    toolName: 'Edit',
    toolInput: 'tooltip.tsx',
    ...overrides
  }
}

function state(overrides: Partial<TeamSoloSessionsState>): TeamSoloSessionsState {
  return {
    agentStatusByPaneKey: {},
    tabsByWorktree: {},
    worktreesByRepo: { 'repo-1': [worktree({})] },
    repos: [repo],
    settings: null,
    cacheTimerByKey: {},
    hostedReviewCache: {},
    workspacePortScan: null,
    claudeAccountRoster: { accounts: [], activeAccountId: null },
    runtimeEnvironments: [],
    sshTargetLabels: new Map(),
    sshConnectionStates: new Map(),
    ...overrides
  } as TeamSoloSessionsState
}

const mocks = vi.hoisted(() => ({ webClient: false }))
vi.mock('@/lib/web-client-location', () => ({ isWebClientLocation: () => mocks.webClient }))

afterEach(() => {
  mocks.webClient = false
})

const claudeRoster = {
  claudeAccountRoster: {
    accounts: [{ id: 'a-1', email: 'dev@example.com' }],
    activeAccountId: 'a-1'
  }
} as Partial<TeamSoloSessionsState>

describe('teamSoloSessionsOf', () => {
  it('names each session after its workspace and project and reads its ticket and note', () => {
    const [session] = teamSoloSessionsOf(
      state({
        agentStatusByPaneKey: { 'tab-1:11111111-1111-4111-8111-111111111111': entry({}) },
        worktreesByRepo: {
          'repo-1': [
            worktree({
              comment: ' check copy ',
              linkedPlaneWorkItem: { identifier: 'ORCA-1012', projectId: 'p' }
            })
          ]
        }
      })
    )
    expect(session).toMatchObject({
      repoName: 'orca-oss',
      worktreeName: 'fix-tooltip',
      isPrimary: false,
      host: { kind: 'local' },
      ticket: { identifier: 'ORCA-1012' },
      note: 'check copy',
      cacheExpiresAt: null,
      advisor: null
    })
  })

  it('finds the workspace from the pane tab when the entry carries no worktree id', () => {
    const sessions = teamSoloSessionsOf(
      state({
        agentStatusByPaneKey: {
          'tab-1:11111111-1111-4111-8111-111111111111': entry({ worktreeId: undefined })
        },
        tabsByWorktree: { 'repo-1::/r/wt': [{ id: 'tab-1' }] } as never
      })
    )
    expect(sessions.map((one) => one.worktreeId)).toEqual(['repo-1::/r/wt'])
  })

  it('drops a pane whose workspace Orca does not know', () => {
    const sessions = teamSoloSessionsOf(
      state({ agentStatusByPaneKey: { x: entry({ paneKey: 'x', worktreeId: 'gone' }) } })
    )
    expect(sessions).toEqual([])
  })

  it('honours promptCacheTimerEnabled for the cache countdown', () => {
    const base = {
      agentStatusByPaneKey: { 'tab-1:11111111-1111-4111-8111-111111111111': entry({}) },
      cacheTimerByKey: { 'tab-1:11111111-1111-4111-8111-111111111111': 1_000 }
    }
    const off = teamSoloSessionsOf(
      state({
        ...base,
        settings: { promptCacheTimerEnabled: false, promptCacheTtlMs: 300_000 } as never
      })
    )
    expect(off[0]?.cacheExpiresAt).toBeNull()
    const on = teamSoloSessionsOf(
      state({
        ...base,
        settings: { promptCacheTimerEnabled: true, promptCacheTtlMs: 300_000 } as never
      })
    )
    expect(on[0]?.cacheExpiresAt).toBe(301_000)
  })

  it('names an SSH workspace by its target label', () => {
    const [session] = teamSoloSessionsOf(
      state({
        agentStatusByPaneKey: { 'tab-1:11111111-1111-4111-8111-111111111111': entry({}) },
        repos: [{ ...repo, connectionId: 'target-1' }],
        sshTargetLabels: new Map([['target-1', 'build server']])
      })
    )
    expect(session?.host).toEqual({
      kind: 'remote',
      name: 'build server',
      environmentId: null,
      reachable: true
    })
  })
})

describe('teamSoloSessionsOf hosts and accounts', () => {
  const live = { 'tab-1:11111111-1111-4111-8111-111111111111': entry({}) }

  it('names a paired host by its environment, not its id', () => {
    const [session] = teamSoloSessionsOf(
      state({
        agentStatusByPaneKey: live,
        repos: [{ ...repo, executionHostId: 'runtime:env-1' } as Repo],
        runtimeEnvironments: [{ id: 'env-1', name: 'imac' }] as never
      })
    )
    expect(session?.host).toEqual({
      kind: 'remote',
      name: 'imac',
      environmentId: 'env-1',
      reachable: true
    })
  })

  it('shows the same account the sidebar chip would', () => {
    const [session] = teamSoloSessionsOf(state({ agentStatusByPaneKey: live, ...claudeRoster }))
    expect(session?.account?.email).toBe('dev@example.com')
  })

  it('says System default like the hover card when no managed account is active', () => {
    const [session] = teamSoloSessionsOf(state({ agentStatusByPaneKey: live }))
    expect(session?.account?.email).toBe('System default')
  })

  it('never names an account on a web client, where the sidebar hides it too', () => {
    mocks.webClient = true
    const [session] = teamSoloSessionsOf(state({ agentStatusByPaneKey: live, ...claudeRoster }))
    expect(session?.account).toBeNull()
  })
})

describe('teamPanelSoloModelFrom', () => {
  it('counts only the questions the Inbox can list', () => {
    const model = teamPanelSoloModelFrom({
      ...state({
        agentStatusByPaneKey: {
          'tab-1:11111111-1111-4111-8111-111111111111': entry({
            state: 'blocked',
            toolName: 'Bash',
            toolInput: 'rm -rf dist'
          })
        }
      }),
      selectedPaneKey: null
    })
    expect(model.rows[0]?.status).toBe('attention')
    expect(model.inbox).toEqual({
      kind: 'ready',
      value: { forYou: 0, waiting: 0, threads: 0, answered: 0 }
    })
  })

  it('puts a blocked session first, opens on the focused pane and counts it in Inbox', () => {
    const model = teamPanelSoloModelFrom({
      ...state({
        agentStatusByPaneKey: {
          'tab-1:11111111-1111-4111-8111-111111111111': entry({}),
          'tab-1:22222222-2222-4222-8222-222222222222': entry({
            paneKey: 'tab-1:22222222-2222-4222-8222-222222222222',
            state: 'blocked',
            toolName: 'AskUserQuestion',
            interactivePrompt: JSON.stringify({
              questions: [
                { question: 'Apply now?', options: [{ label: 'Now' }, { label: 'Later' }] }
              ]
            })
          })
        }
      }),
      selectedPaneKey: 'tab-1:11111111-1111-4111-8111-111111111111'
    })
    expect(model.rows.map((row) => row.paneKey)).toEqual([
      'tab-1:22222222-2222-4222-8222-222222222222',
      'tab-1:11111111-1111-4111-8111-111111111111'
    ])
    expect(model.rows[1]?.liveAction).toEqual({
      kind: 'tool',
      tool: 'Edit',
      detail: 'tooltip.tsx'
    })
    expect(model.rows[1]?.model?.label).toBe('Sonnet 5.5')
    expect(model.selectedPaneKey).toBe('tab-1:11111111-1111-4111-8111-111111111111')
    expect(model.inbox).toEqual({
      kind: 'ready',
      value: { forYou: 1, waiting: 0, threads: 0, answered: 0 }
    })
    expect(model.machines).toBeNull()
  })
})

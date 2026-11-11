import { describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type { Repo, Worktree } from '../../../../shared/types'
import type { TeamSoloSessionsState } from './team-panel-solo-sessions'
import { teamSoloAccountReadsOf } from './use-team-solo-accounts'
import { teamPanelSoloModelFrom } from './use-team-panel-solo-model'

vi.mock('@/lib/web-client-location', () => ({ isWebClientLocation: () => false }))

const PANE = 'tab-1:11111111-1111-4111-8111-111111111111'

const entry: AgentStatusEntry = {
  state: 'working',
  prompt: 'Answer the inbox',
  updatedAt: 1,
  stateStartedAt: 1,
  agentType: 'claude',
  paneKey: PANE,
  worktreeId: 'repo-1::/r/wt',
  stateHistory: []
}

const inputs = {
  agentStatusByPaneKey: { [PANE]: entry },
  tabsByWorktree: {},
  worktreesByRepo: {
    'repo-1': [
      {
        id: 'repo-1::/r/wt',
        repoId: 'repo-1',
        path: '/r/wt',
        displayName: 'wainbox-121',
        comment: '',
        isMainWorktree: false,
        branch: 'refs/heads/wainbox-121',
        head: 'abc'
      } as Worktree
    ]
  },
  repos: [{ id: 'repo-1', path: '/r', displayName: 'orca-wa-inbox' } as Repo],
  settings: null,
  cacheTimerByKey: {},
  hostedReviewCache: {},
  workspacePortScan: null,
  claudeAccountRoster: { accounts: [], activeAccountId: null },
  folderWorkspaces: [],
  runtimeEnvironments: [],
  sshTargetLabels: new Map(),
  sshConnectionStates: new Map(),
  terminalLayoutsByTabId: {},
  ptyIdsByTabId: {},
  selectedPaneKey: null
} as unknown as TeamSoloSessionsState & Parameters<typeof teamPanelSoloModelFrom>[0]

// Why: a member launched on a managed account read 'System default', from its worktree's pin.
describe("a session's account comes from the host that runs it", () => {
  it('names the managed account the host reports for the pane', () => {
    const accounts = new Map([
      [PANE, { provider: 'claude' as const, id: 'a-2', email: 'managed@example.com' }]
    ])
    expect(teamPanelSoloModelFrom(inputs, { accounts }).rows[0]?.account?.email).toBe(
      'managed@example.com'
    )
  })

  it('says System default only when the host reports no managed account', () => {
    const accounts = new Map([[PANE, null]])
    expect(teamPanelSoloModelFrom(inputs, { accounts }).rows[0]?.account?.email).toBe(
      'System default'
    )
  })

  it('asks each pane once, with what the host needs to name its account', () => {
    expect(teamSoloAccountReadsOf([{ entry, host: { kind: 'local' } } as never])).toEqual([
      {
        environmentId: null,
        panes: [{ paneKey: PANE, agentType: 'claude', worktreeId: 'repo-1::/r/wt' }]
      }
    ])
  })
})

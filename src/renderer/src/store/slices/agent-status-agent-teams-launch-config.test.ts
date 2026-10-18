import { describe, expect, it } from 'vitest'
import type { AgentType } from '../../../../shared/agent-status-types'
import type { SleepingAgentLaunchConfig } from '../../../../shared/agent-session-resume'
import { buildAgentResumeStartupPlan } from '../../../../shared/tui-agent-startup'
import type { TuiAgent } from '../../../../shared/tui-agent'
import type { AppState } from '../types'
import { createTestStore, makeTab } from './store-test-helpers'

const PANE_KEY = 'tab-1:leaf-1'
const SESSION_ID = '11111111-2222-4333-8444-555555555555'
const TEAMS_LAUNCH: SleepingAgentLaunchConfig = {
  agentCommand: 'orca claude-teams --dangerously-skip-permissions',
  agentArgs: '--dangerously-skip-permissions',
  agentEnv: {}
}

// The pane as `+` → Claude Agent Teams opens it, then Claude's hooks reporting it.
function launchAndReport(args: { launchAgent: TuiAgent; reportedAgent: AgentType }) {
  const store = createTestStore()
  store.setState({
    tabsByWorktree: { 'wt-1': [makeTab({ id: 'tab-1', worktreeId: 'wt-1' })] }
  } as Partial<AppState>)
  store.getState().registerAgentLaunchConfig(PANE_KEY, TEAMS_LAUNCH, {
    agentType: args.launchAgent,
    launchToken: 'launch-token-1',
    tabId: 'tab-1',
    leafId: 'leaf-1'
  })
  store.getState().setAgentStatus(
    PANE_KEY,
    { state: 'working', prompt: 'lead the team', agentType: args.reportedAgent },
    'Claude',
    { updatedAt: 10, stateStartedAt: 10 },
    { tabId: 'tab-1', worktreeId: 'wt-1' },
    {
      providerSession: { key: 'session_id', id: SESSION_ID },
      launchToken: 'launch-token-1'
    }
  )
  return store
}

describe('Claude Agent Teams launch description (ORCA-617)', () => {
  it('stays bound to the pane when its hooks report the agent as claude', () => {
    const store = launchAndReport({ launchAgent: 'claude-agent-teams', reportedAgent: 'claude' })
    const entry = store.getState().agentStatusByPaneKey[PANE_KEY]

    expect(store.getState().getAgentLaunchConfigForStatusEntry(entry)).toEqual(TEAMS_LAUNCH)
  })

  it('is captured into the sleeping record, so a restore relaunches through orca claude-teams', () => {
    const store = launchAndReport({ launchAgent: 'claude-agent-teams', reportedAgent: 'claude' })
    const record = store.getState().sleepingAgentSessionsByPaneKey[PANE_KEY]

    expect(record).toMatchObject({ agent: 'claude', providerSession: { id: SESSION_ID } })
    expect(record?.launchConfig).toEqual(TEAMS_LAUNCH)
    // Same inputs the cold restore and the sleeping-record relaunch hand the resume plan.
    const plan = buildAgentResumeStartupPlan({
      agent: 'claude',
      providerSession: record!.providerSession,
      cmdOverrides: {},
      platform: 'darwin',
      shell: 'posix',
      agentArgs: record!.launchConfig!.agentArgs,
      agentEnv: record!.launchConfig!.agentEnv,
      agentCommand: record!.launchConfig!.agentCommand
    })
    expect(plan?.launchCommand).toBe(
      `orca claude-teams --dangerously-skip-permissions '--resume' '${SESSION_ID}'`
    )
    expect(plan?.launchConfig.agentCommand).toBe(TEAMS_LAUNCH.agentCommand)
  })

  it('does not bind to a pane reported as another agent', () => {
    const store = launchAndReport({ launchAgent: 'claude-agent-teams', reportedAgent: 'codex' })
    const entry = store.getState().agentStatusByPaneKey[PANE_KEY]

    expect(store.getState().getAgentLaunchConfigForStatusEntry(entry)).toBeUndefined()
  })
})

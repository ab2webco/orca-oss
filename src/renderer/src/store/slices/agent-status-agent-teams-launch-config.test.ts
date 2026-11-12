import { describe, expect, it } from 'vitest'
import type { AgentType } from '../../../../shared/agent-status-types'
import type {
  AgentProviderSessionMetadata,
  SleepingAgentLaunchConfig
} from '../../../../shared/agent-session-resume'
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

// The resume a restart builds from the pane's sleeping record, as pty-connection hands it over.
function resumeCommandOf(record: {
  providerSession: AgentProviderSessionMetadata
  launchConfig?: SleepingAgentLaunchConfig
}) {
  return buildAgentResumeStartupPlan({
    agent: 'claude',
    providerSession: record.providerSession,
    cmdOverrides: {},
    platform: 'darwin',
    shell: 'posix',
    agentArgs: record.launchConfig?.agentArgs ?? '--dangerously-skip-permissions',
    agentEnv: record.launchConfig?.agentEnv ?? {},
    agentCommand: record.launchConfig?.agentCommand ?? null
  })!
}

// Why (ORCA-1171): a restore registered its launch, then consumed the record and its registration
// with it, so the record written after it had none and the next restart resumed plain claude.
describe('a restored Claude Agent Teams lead across restarts', () => {
  it('relaunches through orca claude-teams on the second restart in a row, not only the first', () => {
    const store = launchAndReport({ launchAgent: 'claude-agent-teams', reportedAgent: 'claude' })
    for (const restart of [1, 2]) {
      const record = store.getState().sleepingAgentSessionsByPaneKey[PANE_KEY]!
      const plan = resumeCommandOf(record)
      expect(plan.launchCommand, `restart ${restart}`).toBe(
        `orca claude-teams --dangerously-skip-permissions '--resume' '${SESSION_ID}'`
      )
      // A restart starts the renderer with no live status; the cold restore registers its launch,
      // spawns, then consumes the record, as pty-connection does.
      const token = `restore-token-${restart}`
      store.setState({ agentStatusByPaneKey: {} } as Partial<AppState>)
      store.getState().registerAgentLaunchConfig(PANE_KEY, plan.launchConfig, {
        agentType: 'claude',
        launchToken: token,
        tabId: 'tab-1',
        leafId: 'leaf-1'
      })
      store.getState().consumeSleepingAgentSession(PANE_KEY)
      store
        .getState()
        .setAgentStatus(
          PANE_KEY,
          { state: 'working', prompt: '', agentType: 'claude' },
          'Claude',
          { updatedAt: 10 + restart * 10, stateStartedAt: 10 + restart * 10 },
          { tabId: 'tab-1', worktreeId: 'wt-1' },
          { providerSession: { key: 'session_id', id: SESSION_ID }, launchToken: token }
        )
      store.getState().captureSleepingAgentSessionsByWorktree('wt-1')
    }
    const third = store.getState().sleepingAgentSessionsByPaneKey[PANE_KEY]!
    expect(third.launchConfig?.agentCommand).toBe(TEAMS_LAUNCH.agentCommand)
  })
})

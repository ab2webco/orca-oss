import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultWorkspaceSession } from '../../shared/constants'
import type { SleepingAgentLaunchConfig } from '../../shared/agent-session-resume'
import type { WorkspaceSessionState } from '../../shared/types'
import { OrcaRuntimeService } from './orca-runtime'
import {
  attachClaudeTerminalAccountSwitchServices,
  readClaudeTerminalSwitchReadiness
} from './claude-terminal-account-switch-service'

/**
 * ORCA-187: the daemon keeps a Claude pane's PTY alive across an app restart, so
 * the pane comes back by reattach — and main's runtime comes back empty. Until
 * this change the reattach handed registration nothing, because the launch
 * description shared a gate with the launch token main must not accept from a
 * reattached child. The pane kept its account and lost its argv, and the only
 * signal was the switch refusing when someone finally asked for one.
 */

const REPO_ID = 'repo'
const WORKTREE_PATH = '/worktree'
const WORKTREE_ID = `${REPO_ID}::${WORKTREE_PATH}`
const TAB_ID = 'agent-tab'
const LEAF_ID = '11111111-1111-4111-8111-111111111111'
const PTY_ID = 'daemon-session-1'
const ACCOUNT_ID = 'account-fabiana'
const SESSION_ID = '001c9ef5-69f9-4b1b-809f-7f8dc17e73b3'

const LAUNCH_CONFIG: SleepingAgentLaunchConfig = {
  agentCommand: 'claude',
  agentArgs: '--permission-mode acceptEdits',
  agentEnv: { ORCA_AGENT: 'claude' }
}

const LIVE_REPO = {
  id: REPO_ID,
  path: WORKTREE_PATH,
  displayName: 'repo',
  badgeColor: 'blue',
  addedAt: 1
} as const

const WORKTREE_META = {
  displayName: 'worktree',
  comment: '',
  linkedIssue: null,
  linkedPR: null,
  isArchived: false,
  isUnread: false,
  isPinned: false,
  sortOrder: 0,
  lastActivityAt: 0
} as const

afterEach(() => {
  attachClaudeTerminalAccountSwitchServices(null)
})

function makeRuntime(): OrcaRuntimeService {
  const session: WorkspaceSessionState = { ...getDefaultWorkspaceSession() }
  return new OrcaRuntimeService({
    getRepos: () => [LIVE_REPO],
    getRepo: (id: string) => (id === REPO_ID ? LIVE_REPO : undefined),
    getAllWorktreeMeta: () => ({ [WORKTREE_ID]: WORKTREE_META }),
    getWorktreeMeta: (worktreeId: string) =>
      worktreeId === WORKTREE_ID ? WORKTREE_META : undefined,
    getWorkspaceSession: () => session,
    setWorkspaceSession: vi.fn(),
    flushOrThrow: vi.fn()
  } as never)
}

/** The pane graph the renderer republishes on restore, with its PTY reattached. */
function syncAgentPane(runtime: OrcaRuntimeService): void {
  runtime.attachWindow(1)
  runtime.syncWindowGraph(1, {
    tabs: [
      {
        tabId: TAB_ID,
        worktreeId: WORKTREE_ID,
        title: 'Agent',
        activeLeafId: LEAF_ID,
        layout: null
      }
    ],
    leaves: [
      {
        tabId: TAB_ID,
        worktreeId: WORKTREE_ID,
        leafId: LEAF_ID,
        paneRuntimeId: 1,
        ptyId: PTY_ID
      }
    ]
  } as never)
}

/** The worktree the pane runs in; its path is what files the Claude transcript. */
function stubResolvedWorktree(runtime: OrcaRuntimeService): void {
  const internals = runtime as unknown as {
    listResolvedWorktrees: () => Promise<unknown[]>
  }
  vi.spyOn(internals, 'listResolvedWorktrees').mockResolvedValue([
    { id: WORKTREE_ID, path: WORKTREE_PATH, repoId: REPO_ID, branch: 'main' }
  ])
}

/** The pane has a live Claude session; the switch reads it through this seam. */
function stubObservedClaudeSession(runtime: OrcaRuntimeService): void {
  vi.spyOn(runtime, 'getExactWorkerProviderSessionIdentity').mockReturnValue({
    agent: 'claude',
    providerSession: { key: 'session_id', id: SESSION_ID }
  } as never)
}

function attachSwitchServices(): void {
  attachClaudeTerminalAccountSwitchServices({
    getSettings: () => ({ claudeManagedAccounts: [] }),
    prepareClaudeAuth: async () => ({}) as never,
    getPtyClaudeAccountId: () => ACCOUNT_ID
  })
}

describe('a Claude pane restored after an app restart', () => {
  it('keeps the launch config the switch relaunches from', async () => {
    const runtime = makeRuntime()
    syncAgentPane(runtime)
    // The reattach branch: a launch description, and no token main can prove.
    runtime.registerPty(PTY_ID, WORKTREE_ID, null, {
      tabId: TAB_ID,
      leafId: LEAF_ID,
      launchConfig: LAUNCH_CONFIG,
      launchAgent: 'claude'
    })

    const snapshot = await runtime.snapshotClaudeTerminalSwitchTarget({
      kind: 'pty',
      ptyId: PTY_ID
    })

    expect(snapshot.ok).toBe(true)
    expect(snapshot.ok && snapshot.launchConfig).toEqual(LAUNCH_CONFIG)
  })

  it('does not gain the orchestration token its running child never received', async () => {
    const runtime = makeRuntime()
    syncAgentPane(runtime)
    runtime.registerPty(PTY_ID, WORKTREE_ID, null, {
      tabId: TAB_ID,
      leafId: LEAF_ID,
      launchConfig: LAUNCH_CONFIG,
      launchAgent: 'claude'
    })

    const ptys = (runtime as unknown as { ptysById: Map<string, { launchToken: string | null }> })
      .ptysById
    expect(ptys.get(PTY_ID)?.launchToken).toBeNull()
  })

  it('reports itself switchable before anyone asks for a switch', async () => {
    const runtime = makeRuntime()
    syncAgentPane(runtime)
    stubObservedClaudeSession(runtime)
    stubResolvedWorktree(runtime)
    attachSwitchServices()
    runtime.registerPty(PTY_ID, WORKTREE_ID, null, {
      tabId: TAB_ID,
      leafId: LEAF_ID,
      launchConfig: LAUNCH_CONFIG,
      launchAgent: 'claude'
    })

    const readiness = readClaudeTerminalSwitchReadiness(
      await runtime.snapshotClaudeTerminalSwitchTarget({ kind: 'pty', ptyId: PTY_ID })
    )

    expect(readiness).toEqual({ state: 'ready' })
  })

  it('says which prerequisite it lost when the restore carried no launch config', async () => {
    const runtime = makeRuntime()
    syncAgentPane(runtime)
    stubObservedClaudeSession(runtime)
    stubResolvedWorktree(runtime)
    attachSwitchServices()
    // A pane whose agent left no resume record has nothing to rebuild argv from;
    // an honest refusal that names it beats a silent loss of capability.
    runtime.registerPty(PTY_ID, WORKTREE_ID, null, { tabId: TAB_ID, leafId: LEAF_ID })

    const readiness = readClaudeTerminalSwitchReadiness(
      await runtime.snapshotClaudeTerminalSwitchTarget({ kind: 'pty', ptyId: PTY_ID })
    )

    expect(readiness).toEqual({ state: 'unavailable', reason: 'missing-launch-config' })
  })

  it('keeps the launch description that really ran when a reattach re-registers', async () => {
    const runtime = makeRuntime()
    syncAgentPane(runtime)
    runtime.registerPty(PTY_ID, WORKTREE_ID, null, {
      tabId: TAB_ID,
      leafId: LEAF_ID,
      launchConfig: LAUNCH_CONFIG,
      launchToken: 'proven-at-spawn',
      launchAgent: 'claude'
    })

    // A renderer reload reattaches against a main that never died; its config is
    // rebuilt from a resume plan and must not outrank the launch that ran.
    runtime.registerPty(PTY_ID, WORKTREE_ID, null, {
      tabId: TAB_ID,
      leafId: LEAF_ID,
      launchConfig: { agentCommand: 'claude', agentArgs: '', agentEnv: {} },
      launchAgent: 'claude'
    })

    const snapshot = await runtime.snapshotClaudeTerminalSwitchTarget({
      kind: 'pty',
      ptyId: PTY_ID
    })
    expect(snapshot.ok && snapshot.launchConfig).toEqual(LAUNCH_CONFIG)
    const ptys = (runtime as unknown as { ptysById: Map<string, { launchToken: string | null }> })
      .ptysById
    expect(ptys.get(PTY_ID)?.launchToken).toBe('proven-at-spawn')
  })
})

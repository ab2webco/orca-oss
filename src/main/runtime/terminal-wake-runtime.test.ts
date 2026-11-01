import { describe, expect, it, vi } from 'vitest'
import { getDefaultWorkspaceSession } from '../../shared/constants'
import type { SleepingAgentSessionRecord } from '../../shared/agent-session-resume'
import type { GameMemberSession } from '../../shared/orchestrator-game-member-sessions'
import type { WorkspaceSessionState } from '../../shared/types'
import { OrcaRuntimeService } from './orca-runtime'
import { OrchestrationDb } from './orchestration/db'
import { inspectRemoteAttachment } from './rpc/methods/orchestration-federation-control'

// Why: after a host restart a member's pane comes back asleep, and a lead on
// another machine could only wake it by clicking it in that host's UI (ORCA-915).

const REPO_ID = 'repo'
const WORKTREE_PATH = '/worktree'
const WORKTREE_ID = `${REPO_ID}::${WORKTREE_PATH}`
const TAB_ID = 'member-tab'
const LEAF_ID = '11111111-1111-4111-8111-111111111111'
const PANE_KEY = `${TAB_ID}:${LEAF_ID}`
const REPO = {
  id: REPO_ID,
  path: WORKTREE_PATH,
  displayName: 'repo',
  badgeColor: 'blue',
  addedAt: 1
}
const META = {
  displayName: 'worktree',
  comment: '',
  linkedIssue: null,
  linkedPR: null,
  isArchived: false,
  isUnread: false,
  isPinned: false,
  sortOrder: 0,
  lastActivityAt: 0
}

const RECORD: SleepingAgentSessionRecord = {
  paneKey: PANE_KEY,
  tabId: TAB_ID,
  worktreeId: WORKTREE_ID,
  agent: 'claude',
  providerSession: { key: 'session_id', id: 'member-session' },
  prompt: 'implement ORCA-915',
  state: 'working',
  capturedAt: 10,
  updatedAt: 20,
  origin: 'quit'
}

const MEMBER: GameMemberSession = {
  ticket: 'ORCA-915',
  name: 'Nova',
  runId: 'run-1',
  taskId: 'task-1',
  dispatchId: null,
  worktreeId: WORKTREE_ID,
  branch: 'fabolivark/orca-915',
  agent: 'claude',
  accountId: 'acct-1',
  account: 'member@example.com',
  sessionId: 'member-session',
  lastState: 'working',
  launchedAt: '2026-10-30T10:00:00.000Z',
  updatedAt: '2026-10-30T10:00:00.000Z'
}

function syncMemberPane(runtime: OrcaRuntimeService, ptyId: string | null): void {
  runtime.syncWindowGraph(1, {
    tabs: [
      {
        tabId: TAB_ID,
        worktreeId: WORKTREE_ID,
        title: 'Member',
        activeLeafId: LEAF_ID,
        layout: null
      }
    ],
    leaves: [{ tabId: TAB_ID, worktreeId: WORKTREE_ID, leafId: LEAF_ID, paneRuntimeId: 1, ptyId }]
  })
}

function makeRuntime(
  withWindow: boolean,
  pane: 'mounted' | 'unmounted' = 'mounted'
): {
  runtime: OrcaRuntimeService
  wakeSleepingAgentPane: ReturnType<typeof vi.fn>
} {
  let session: WorkspaceSessionState = {
    ...getDefaultWorkspaceSession(),
    sleepingAgentSessionsByPaneKey: { [PANE_KEY]: RECORD }
  }
  const runtime = new OrcaRuntimeService({
    getRepos: () => [REPO],
    getRepo: (id: string) => (id === REPO_ID ? REPO : undefined),
    getAllWorktreeMeta: () => ({ [WORKTREE_ID]: META }),
    getWorktreeMeta: (id: string) => (id === WORKTREE_ID ? META : undefined),
    getWorkspaceSession: () => session,
    setWorkspaceSession: (next: WorkspaceSessionState) => {
      session = next
    },
    flushOrThrow: vi.fn()
  } as never)
  // The host renderer resumes the agent in the same pane, then drops the record.
  const wakeSleepingAgentPane = vi.fn((paneKey: string) => {
    setTimeout(() => {
      runtime.registerPty('pty-member', WORKTREE_ID)
      syncMemberPane(runtime, 'pty-member')
      const { [paneKey]: _woken, ...rest } = session.sleepingAgentSessionsByPaneKey ?? {}
      session = { ...session, sleepingAgentSessionsByPaneKey: rest }
    }, 10)
  })
  runtime.setNotifier({ wakeSleepingAgentPane } as never)
  runtime.attachWindow(1)
  // Why a cast: the window lookup is private and needs Electron's BrowserWindow.
  ;(runtime as unknown as { getAvailableAuthoritativeWindow: () => unknown })[
    'getAvailableAuthoritativeWindow'
  ] = () => (withWindow ? {} : null)
  if (pane === 'mounted') {
    syncMemberPane(runtime, null)
  } else {
    // After a restart a background worktree publishes no leaf for its slept pane.
    runtime.syncWindowGraph(1, { tabs: [], leaves: [] })
  }
  return { runtime, wakeSleepingAgentPane }
}

async function sleepingHandleOf(runtime: OrcaRuntimeService): Promise<string> {
  const { terminals } = await runtime.listTerminals(`id:${WORKTREE_ID}`)
  const row = terminals.find((terminal) => terminal.liveness === 'sleeping')
  expect(row).toBeDefined()
  return row!.handle
}

describe('terminal.wake', () => {
  it.each(['mounted', 'unmounted'] as const)(
    'wakes a sleeping %s member pane and hands back a running handle',
    async (pane) => {
      const { runtime, wakeSleepingAgentPane } = makeRuntime(true, pane)
      const asleep = await sleepingHandleOf(runtime)

      const woken = await runtime.wakeTerminal(asleep)

      expect(wakeSleepingAgentPane).toHaveBeenCalledExactlyOnceWith(PANE_KEY)
      expect(woken).toMatchObject({ status: 'woken', paneKey: PANE_KEY })
      const { terminals } = await runtime.listTerminals(`id:${WORKTREE_ID}`)
      expect(terminals.find((terminal) => terminal.handle === woken.handle)).toMatchObject({
        liveness: 'running',
        leafId: LEAF_ID
      })
    }
  )

  it('answers terminal_asleep to a write on the unmounted pane until it is woken', async () => {
    const { runtime } = makeRuntime(true, 'unmounted')
    const asleep = await sleepingHandleOf(runtime)
    await expect(runtime.readTerminal(asleep)).rejects.toThrow('terminal_asleep')
  })

  it.each(['mounted', 'unmounted'] as const)(
    'refuses a %s pane on a headless host instead of claiming it resumed',
    async (pane) => {
      const { runtime, wakeSleepingAgentPane } = makeRuntime(false, pane)
      const asleep = await sleepingHandleOf(runtime)
      await expect(runtime.wakeTerminal(asleep)).rejects.toThrow('terminal_wake_unavailable')
      expect(wakeSleepingAgentPane).not.toHaveBeenCalled()
    }
  )

  it('refuses an unknown handle as stale', async () => {
    const { runtime } = makeRuntime(true)
    await expect(runtime.wakeTerminal('term_unknown')).rejects.toThrow('terminal_handle_stale')
  })
})

describe('terminal.list owner of a sleeping row', () => {
  it.each(['mounted', 'unmounted'] as const)(
    'names the lead, ticket and account of the %s member pane a restart left asleep',
    async (pane) => {
      const { runtime } = makeRuntime(true, pane)
      const read = vi.fn(async (projectKey: string) => ({
        ok: true as const,
        members: projectKey === `repo:${REPO_ID}` ? [MEMBER] : []
      }))
      // Why a cast: the member file and the run database are private and touch disk.
      Object.assign(runtime as object, {
        gameMemberSessions: { read },
        getOrchestrationDbIfAvailable: () => ({
          getRun: (id: string) => (id === 'run-1' ? { coordinator_handle: 'term_lead' } : undefined)
        })
      })

      const { terminals } = await runtime.listTerminals(`id:${WORKTREE_ID}`)

      expect(
        terminals.find((terminal) => terminal.liveness === 'sleeping')?.sleepingAgent
      ).toMatchObject({
        owner: { lead: 'term_lead', ticket: 'ORCA-915', account: 'member@example.com' }
      })
      expect(read).toHaveBeenCalledTimes(1)
    }
  )
})

describe('game resume of a member whose pane slept', () => {
  const resumeOf = (runtime: OrcaRuntimeService, member: GameMemberSession): Promise<string> =>
    (
      runtime as unknown as { resumeGameMemberSession: (one: GameMemberSession) => Promise<string> }
    ).resumeGameMemberSession(member)

  it.each(['mounted', 'unmounted'] as const)(
    'wakes the %s pane in place instead of opening a second agent on its conversation',
    async (pane) => {
      const { runtime, wakeSleepingAgentPane } = makeRuntime(true, pane)
      const reopen = vi.fn(async () => 'term_second_agent')
      Object.assign(runtime as object, { reopenClaudeConversation: reopen })

      const terminal = await resumeOf(runtime, MEMBER)

      expect(wakeSleepingAgentPane).toHaveBeenCalledExactlyOnceWith(PANE_KEY)
      expect(reopen).not.toHaveBeenCalled()
      const { terminals } = await runtime.listTerminals(`id:${WORKTREE_ID}`)
      expect(terminals.find((one) => one.handle === terminal)).toMatchObject({
        liveness: 'running',
        leafId: LEAF_ID
      })
    }
  )

  it('reopens the conversation when no pane of it is asleep', async () => {
    const { runtime, wakeSleepingAgentPane } = makeRuntime(true)
    const reopen = vi.fn(async () => 'term_reopened')
    Object.assign(runtime as object, { reopenClaudeConversation: reopen })

    await expect(resumeOf(runtime, { ...MEMBER, sessionId: 'another-session' })).resolves.toBe(
      'term_reopened'
    )
    expect(wakeSleepingAgentPane).not.toHaveBeenCalled()
  })
})

/** A member a paired lead placed in the sleeping pane, attached before the host restarted. */
function attachRemoteMember(runtime: OrcaRuntimeService): OrchestrationDb {
  const db = new OrchestrationDb(':memory:')
  runtime.setOrchestrationDb(db)
  db.createRemoteDispatchAttachment({
    dispatchId: 'ctx_remote',
    taskId: 'task_remote',
    homePeerFingerprint: 'home',
    protocolVersion: 1,
    runtimeEpoch: 'before-restart',
    mutationReceipt: {
      callerFingerprint: 'home',
      requestId: 'req-1',
      method: 'orchestration.workerStart',
      payloadHash: 'hash'
    }
  })
  db.prepareRemoteAttachmentAuthority({
    dispatchId: 'ctx_remote',
    paneKey: PANE_KEY,
    processIncarnation: 'pty-before-restart:1',
    worktreeId: WORKTREE_ID,
    terminalHandle: 'term_before_restart',
    setupState: 'ready',
    effects: []
  })
  db.markRemoteAttachmentReady('ctx_remote')
  return db
}

describe('waking a member a paired lead placed on this host', () => {
  it.each(['mounted', 'unmounted'] as const)(
    'rebinds its attachment to the woken %s pane, so the lead sees its member again',
    async (pane) => {
      const { runtime } = makeRuntime(true, pane)
      const db = attachRemoteMember(runtime)

      const woken = await runtime.wakeTerminal(await sleepingHandleOf(runtime))

      const incarnation = runtime.getTerminalProcessIncarnation(woken.handle!)
      expect(db.getRemoteDispatchAttachment('ctx_remote')?.terminal_handle).toBe(woken.handle)
      expect(
        db.isRemoteAttachmentProcessCurrent({
          dispatchId: 'ctx_remote',
          paneKey: PANE_KEY,
          processIncarnation: incarnation
        })
      ).toBe(true)
      db.close()
    }
  )
})

describe('federationShow of a member whose pane slept', () => {
  it.each(['mounted', 'unmounted'] as const)(
    'reports the %s pane asleep with its handle, not missing',
    async (pane) => {
      const { runtime } = makeRuntime(true, pane)
      const db = attachRemoteMember(runtime)

      const observation = await inspectRemoteAttachment(runtime, 'ctx_remote')

      expect(observation).toMatchObject({
        status: 'asleep',
        terminal: null,
        asleep: await sleepingHandleOf(runtime)
      })
      // federationShow describes the asleep member from this handle.
      await expect(
        runtime.showTerminal((observation as { asleep: string }).asleep)
      ).resolves.toMatchObject({ liveness: 'sleeping', worktreeId: WORKTREE_ID })
      db.close()
    }
  )
})

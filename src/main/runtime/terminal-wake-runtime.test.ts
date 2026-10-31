import { describe, expect, it, vi } from 'vitest'
import { getDefaultWorkspaceSession } from '../../shared/constants'
import type { SleepingAgentSessionRecord } from '../../shared/agent-session-resume'
import type { WorkspaceSessionState } from '../../shared/types'
import { OrcaRuntimeService } from './orca-runtime'

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
        members:
          projectKey === `repo:${REPO_ID}`
            ? [
                {
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
              ]
            : []
      }))
      // Why a cast: the member file and the run database are private and touch disk.
      Object.assign(runtime as object, {
        gameMemberSessions: { read },
        getOrchestrationDb: () => ({
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

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type { AgentSessionLogReading } from '../../../../shared/agent-session-log-state'
import type { SleepingAgentSessionRecord } from '../../../../shared/agent-session-resume'
import { parseWorkspaceSession } from '../../../../shared/workspace-session-schema'
import { buildWorkspaceSessionPayload } from '@/lib/workspace-session'
import { createTestStore, makeTab, makeWorktree, seedStore } from './store-test-helpers'

const mockKill = vi.fn().mockResolvedValue(undefined)
const mockReadSessionLog = vi.fn<(identity: unknown) => Promise<AgentSessionLogReading>>()

vi.stubGlobal('window', {
  api: {
    pty: { kill: mockKill },
    agentSessionLog: { readForIdentity: mockReadSessionLog },
    runtime: { call: vi.fn().mockResolvedValue({ ok: true, result: {} }) },
    runtimeEnvironments: { call: vi.fn().mockResolvedValue({ ok: true, result: {} }) }
  }
})

const REPO_ID = 'repo1'
const WORKTREE_ID = `${REPO_ID}::/repo/interrupted`
const TAB_ID = 'ba0a3e19-3f3a-4c1a-9e6a-8f0b1c2d3e4f'
const LEAF_ID = '5f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5'
const PANE_KEY = `${TAB_ID}:${LEAF_ID}`
const PROVIDER_SESSION_ID = '019feb51-2269-71c2-89c6-faa8dc65c8dc'

function interruptedWorkerRecord(): SleepingAgentSessionRecord {
  return {
    paneKey: PANE_KEY,
    tabId: TAB_ID,
    worktreeId: WORKTREE_ID,
    agent: 'codex',
    providerSession: { key: 'session_id', id: PROVIDER_SESSION_ID },
    prompt: 'keep going from where you were',
    state: 'working',
    capturedAt: 1,
    updatedAt: 1,
    origin: 'live'
  }
}

function liveStatus(state: AgentStatusEntry['state'], interrupted?: boolean): AgentStatusEntry {
  return {
    paneKey: PANE_KEY,
    tabId: TAB_ID,
    worktreeId: WORKTREE_ID,
    state,
    prompt: 'keep going from where you were',
    updatedAt: 2,
    stateStartedAt: 2,
    stateHistory: [],
    ...(interrupted === undefined ? {} : { interrupted })
  }
}

function seedInterruptedWorker(status?: AgentStatusEntry): ReturnType<typeof createTestStore> {
  const store = createTestStore()
  seedStore(store, {
    worktreesByRepo: {
      [REPO_ID]: [makeWorktree({ id: WORKTREE_ID, repoId: REPO_ID, path: '/repo/interrupted' })]
    },
    tabsByWorktree: {
      [WORKTREE_ID]: [makeTab({ id: TAB_ID, worktreeId: WORKTREE_ID, ptyId: 'pty-worker' })]
    },
    ptyIdsByTabId: { [TAB_ID]: ['pty-worker'] },
    terminalLayoutsByTabId: {
      [TAB_ID]: {
        root: { type: 'leaf', leafId: LEAF_ID },
        activeLeafId: LEAF_ID,
        expandedLeafId: null,
        ptyIdsByLeafId: { [LEAF_ID]: 'pty-worker' }
      }
    },
    sleepingAgentSessionsByPaneKey: { [PANE_KEY]: interruptedWorkerRecord() },
    ...(status ? { agentStatusByPaneKey: { [PANE_KEY]: status } } : {})
  })
  return store
}

// An interrupted agent reaches the renderer as a bare PTY exit, exactly like a deliberately
// retired one, so nothing here may treat the exit itself as proof the work is finished.
describe('interrupted agent resume preservation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockKill.mockResolvedValue(undefined)
    mockReadSessionLog.mockResolvedValue({
      read: true,
      state: 'working',
      lastTurnAtMs: null,
      queuedInput: { supported: false, reason: 'agent-unsupported' },
      unparsedRecords: 0
    })
  })

  it('keeps the exact provider session of a worker whose process died mid-task', () => {
    const store = seedInterruptedWorker()

    store.getState().closeTab(TAB_ID, { reason: 'pty-exit' })

    expect(store.getState().tabsByWorktree[WORKTREE_ID]).toEqual([])
    expect(store.getState().sleepingAgentSessionsByPaneKey[PANE_KEY]).toMatchObject({
      state: 'working',
      origin: 'live',
      providerSession: { key: 'session_id', id: PROVIDER_SESSION_ID }
    })
  })

  it('carries that resume authority across a restart', () => {
    const store = seedInterruptedWorker()
    store.getState().closeTab(TAB_ID, { reason: 'pty-exit' })

    const parsed = parseWorkspaceSession(
      JSON.parse(JSON.stringify(buildWorkspaceSessionPayload(store.getState()))) as unknown
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) {
      throw new Error(parsed.error)
    }
    expect(parsed.value.sleepingAgentSessionsByPaneKey?.[PANE_KEY]?.providerSession.id).toBe(
      PROVIDER_SESSION_ID
    )

    const restarted = seedInterruptedWorker()
    restarted.setState({ sleepingAgentSessionsByPaneKey: {} })
    restarted.getState().hydrateWorkspaceSession(parsed.value)

    expect(restarted.getState().sleepingAgentSessionsByPaneKey[PANE_KEY]).toMatchObject({
      state: 'working',
      origin: 'live',
      providerSession: { key: 'session_id', id: PROVIDER_SESSION_ID }
    })
  })
  // A runtime-initiated close (`orca terminal close`, worker release) reaches the renderer
  // as an explicit tab close since 2eb3e11327, so it takes the 'user' retirement path with
  // the pane's status still live. An interrupt-synthesized 'done' must not read as finished.
  it('keeps an interrupt-synthesized done status out of a user close retirement', () => {
    const store = seedInterruptedWorker(liveStatus('done', true))

    store.getState().closeTab(TAB_ID)

    expect(store.getState().sleepingAgentSessionsByPaneKey[PANE_KEY]).toMatchObject({
      providerSession: { key: 'session_id', id: PROVIDER_SESSION_ID }
    })
  })

  it('keeps a still-working pane whose session log cannot prove the turn ended', async () => {
    const store = seedInterruptedWorker(liveStatus('working'))

    store.getState().closeTab(TAB_ID)
    await vi.waitFor(() => expect(mockReadSessionLog).toHaveBeenCalled())
    // The retirement set() runs several microtasks past the log read; yield the turn.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(store.getState().sleepingAgentSessionsByPaneKey[PANE_KEY]).toMatchObject({
      providerSession: { key: 'session_id', id: PROVIDER_SESSION_ID }
    })
  })
  // A runtime-driven close (`orca terminal close`, worker release, a paired phone)
  // reaches the renderer as an explicit tab close since #14590, with the pane's
  // status still live. It tears the tab down like a user close but is not the user
  // vouching that the agent finished, so resume authority has to survive it.
  it('keeps a genuinely completed agent through a runtime-initiated close', () => {
    const store = seedInterruptedWorker(liveStatus('done'))

    store.getState().closeTab(TAB_ID, { runtimeInitiated: true })

    expect(store.getState().tabsByWorktree[WORKTREE_ID]).toEqual([])
    expect(store.getState().sleepingAgentSessionsByPaneKey[PANE_KEY]).toMatchObject({
      providerSession: { key: 'session_id', id: PROVIDER_SESSION_ID }
    })
  })

  // The control for the case above: the same pane, same status, closed by the user,
  // still retires. Without this the new flag could be preserving everything.
  it("still retires a genuinely completed agent on the user's own close", () => {
    const store = seedInterruptedWorker(liveStatus('done'))

    store.getState().closeTab(TAB_ID)

    expect(store.getState().sleepingAgentSessionsByPaneKey[PANE_KEY]).toBeUndefined()
  })
})

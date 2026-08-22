import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SleepingAgentSessionRecord } from '../../../../shared/agent-session-resume'
import { parseWorkspaceSession } from '../../../../shared/workspace-session-schema'
import { buildWorkspaceSessionPayload } from '@/lib/workspace-session'
import { createTestStore, makeTab, makeWorktree, seedStore } from './store-test-helpers'

const mockKill = vi.fn().mockResolvedValue(undefined)

vi.stubGlobal('window', {
  api: {
    pty: { kill: mockKill },
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

function seedInterruptedWorker(): ReturnType<typeof createTestStore> {
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
    sleepingAgentSessionsByPaneKey: { [PANE_KEY]: interruptedWorkerRecord() }
  })
  return store
}

// An interrupted agent reaches the renderer as a bare PTY exit, exactly like a deliberately
// retired one, so nothing here may treat the exit itself as proof the work is finished.
describe('interrupted agent resume preservation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockKill.mockResolvedValue(undefined)
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
})

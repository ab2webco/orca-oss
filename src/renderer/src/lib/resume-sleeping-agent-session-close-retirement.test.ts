import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SleepingAgentSessionRecord } from '../../../shared/agent-session-resume'
import { useAppStore } from '@/store'
import { resumeSleepingAgentSessionsForWorktree } from './resume-sleeping-agent-session'

const initialAppStoreState = useAppStore.getState()

afterEach(() => {
  vi.unstubAllGlobals()
  useAppStore.setState(initialAppStoreState, true)
})

function makeRecord(overrides: Partial<SleepingAgentSessionRecord> = {}): SleepingAgentSessionRecord {
  return {
    paneKey: 'tab-1:leaf-1',
    tabId: 'tab-1',
    worktreeId: 'wt-1',
    agent: 'claude',
    providerSession: { key: 'session_id', id: 'sess-1' },
    prompt: 'finish the task',
    state: 'working',
    capturedAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

function makeTerminalTab(id: string, worktreeId: string): Record<string, unknown> {
  return {
    id,
    ptyId: null,
    worktreeId,
    title: 'shell',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 1
  }
}

describe('ORCA-272: a tab closed mid-turn stays resumable end-to-end', () => {
  it('preserves the live-checkpoint record on close and lets worktree activation relaunch it', () => {
    // Why: exercises the real closeTab path (not a synthetic sleepingAgentSessionsByPaneKey
    // seed) so this proves the full loop the ticket asks for: interrupt, close, reopen,
    // resume — not just that resumeSleepingAgentSessionsForWorktree can consume a record
    // some other test constructed by hand. The top-level afterEach's vi.unstubAllGlobals()
    // cleans this up.
    vi.stubGlobal('window', {
      api: {
        pty: { kill: vi.fn().mockResolvedValue(undefined) },
        runtime: { call: vi.fn().mockResolvedValue({ ok: true, result: {} }) },
        runtimeEnvironments: { call: vi.fn().mockResolvedValue({ ok: true, result: {} }) }
        // Why: agentSessionLog intentionally omitted, like a renderer whose preload hasn't
        // loaded that surface yet — the close must still default to preserve, not throw.
      }
    })
    const record = makeRecord({ origin: 'live' })
    useAppStore.setState({
      tabsByWorktree: { 'wt-1': [makeTerminalTab('tab-1', 'wt-1')] },
      sleepingAgentSessionsByPaneKey: { [record.paneKey]: record },
      agentStatusByPaneKey: {
        [record.paneKey]: {
          state: 'working',
          prompt: record.prompt,
          updatedAt: 1,
          stateStartedAt: 1,
          paneKey: record.paneKey,
          agentType: record.agent,
          stateHistory: [],
          providerSession: record.providerSession
        }
      }
    } as never)

    useAppStore.getState().closeTab('tab-1')

    expect(useAppStore.getState().tabsByWorktree['wt-1']).toEqual([])
    // Why: mid-turn ('working', not 'done') and no session-log authority wired — the only
    // correct outcome is preserve (ORCA-272).
    expect(useAppStore.getState().sleepingAgentSessionsByPaneKey[record.paneKey]).toBe(record)

    const launched = resumeSleepingAgentSessionsForWorktree('wt-1')

    expect(launched).toBe(1)
    const resumedTab = useAppStore.getState().tabsByWorktree['wt-1']?.[0]
    expect(resumedTab?.launchAgent).toBe('claude')
    expect(useAppStore.getState().sleepingAgentSessionsByPaneKey[record.paneKey]).toBeUndefined()
  })
})

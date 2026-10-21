import { afterEach, describe, expect, it } from 'vitest'
import type { SleepingAgentSessionRecord } from '../../../shared/agent-session-resume'
import { useAppStore } from '@/store'
import { resumeSleepingAgentSessionsForWorktree } from './resume-sleeping-agent-session'

const initialAppStoreState = useAppStore.getState()

afterEach(() => {
  useAppStore.setState(initialAppStoreState, true)
})

function makeRecord(
  overrides: Partial<SleepingAgentSessionRecord> = {}
): SleepingAgentSessionRecord {
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

function makeTerminalTab(id: string): Record<string, unknown> {
  return { id, ptyId: null, worktreeId: 'wt-1', title: 'shell', sortOrder: 0, createdAt: 1 }
}

// ORCA-718: only tabs open at quit come back; a record whose tab is gone was closed.
describe('resumeSleepingAgentSessionsForWorktree with a closed tab', () => {
  for (const origin of ['live', 'quit', undefined] as const) {
    it(`does not reopen a closed tab from its ${origin ?? 'legacy'} record`, () => {
      const record = makeRecord(origin ? { origin } : {})
      useAppStore.setState({
        tabsByWorktree: { 'wt-1': [makeTerminalTab('tab-other')] },
        sleepingAgentSessionsByPaneKey: { [record.paneKey]: record }
      } as never)

      const launched = resumeSleepingAgentSessionsForWorktree('wt-1')

      expect(launched).toBe(0)
      const state = useAppStore.getState()
      expect(state.tabsByWorktree['wt-1']?.map((tab) => tab.id)).toEqual(['tab-other'])
      // Kept so the conversation can still be offered by hand.
      expect(state.sleepingAgentSessionsByPaneKey[record.paneKey]).toBe(record)
    })
  }

  it('does not reopen a closed tab whose record has no tabId field', () => {
    const { tabId: _omitted, ...record } = makeRecord({ origin: 'quit' })
    useAppStore.setState({
      tabsByWorktree: { 'wt-1': [] },
      sleepingAgentSessionsByPaneKey: { [record.paneKey]: record }
    } as never)

    expect(resumeSleepingAgentSessionsForWorktree('wt-1')).toBe(0)
    expect(useAppStore.getState().tabsByWorktree['wt-1']).toEqual([])
  })

  it('still resumes a record whose tab survived without its pane', () => {
    const record = makeRecord({ origin: 'live' })
    useAppStore.setState({
      tabsByWorktree: { 'wt-1': [makeTerminalTab('tab-1')] },
      sleepingAgentSessionsByPaneKey: { [record.paneKey]: record }
    } as never)

    expect(resumeSleepingAgentSessionsForWorktree('wt-1')).toBe(1)
  })

  it('still wakes a slept worktree record', () => {
    const record = makeRecord({ origin: 'worktree-sleep' })
    useAppStore.setState({
      tabsByWorktree: { 'wt-1': [] },
      sleepingAgentSessionsByPaneKey: { [record.paneKey]: record }
    } as never)

    expect(resumeSleepingAgentSessionsForWorktree('wt-1')).toBe(1)
  })
})

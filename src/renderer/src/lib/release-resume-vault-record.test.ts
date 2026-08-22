import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SleepingAgentSessionRecord } from '../../../shared/agent-session-resume'
import type { AgentStatusEntry } from '../../../shared/agent-status-types'
import { useAppStore } from '@/store'
import {
  releaseResumeVaultProjectRecords,
  releaseResumeVaultRecord
} from './release-resume-vault-record'

function makeRecord(overrides: Partial<SleepingAgentSessionRecord> = {}): SleepingAgentSessionRecord {
  return {
    paneKey: 'tab-1:leaf-1',
    tabId: 'tab-1',
    worktreeId: 'repo1::/tmp/wt',
    agent: 'claude',
    providerSession: {
      key: 'session_id',
      id: 'sess-1',
      transcriptPath: '/home/user/.claude/projects/repo1/sess-1.jsonl'
    },
    prompt: 'do the thing',
    state: 'done',
    interrupted: true,
    capturedAt: 1_000,
    updatedAt: 1_000,
    ...overrides
  }
}

function makeAgentStatusEntry(overrides: Partial<AgentStatusEntry> = {}): AgentStatusEntry {
  return {
    state: 'working',
    prompt: 'do the thing',
    updatedAt: Date.now(),
    stateStartedAt: Date.now(),
    paneKey: 'tab-1:leaf-1',
    stateHistory: [],
    ...overrides
  }
}

const initialState = useAppStore.getState()

afterEach(() => {
  useAppStore.setState(initialState, true)
})

describe('releaseResumeVaultRecord', () => {
  it('removes exactly the targeted record and leaves siblings untouched', () => {
    const target = makeRecord()
    const sibling = makeRecord({ paneKey: 'tab-1:leaf-2', providerSession: { key: 'session_id', id: 'sess-2' } })
    useAppStore.setState({
      sleepingAgentSessionsByPaneKey: {
        [target.paneKey]: target,
        [sibling.paneKey]: sibling
      }
    })

    const outcome = releaseResumeVaultRecord({
      paneKey: target.paneKey,
      agent: target.agent,
      providerSession: target.providerSession
    })

    expect(outcome).toEqual({ released: true })
    const state = useAppStore.getState()
    expect(state.sleepingAgentSessionsByPaneKey[target.paneKey]).toBeUndefined()
    expect(state.sleepingAgentSessionsByPaneKey[sibling.paneKey]).toEqual(sibling)
  })

  it('refuses when the pane key no longer holds any record', () => {
    useAppStore.setState({ sleepingAgentSessionsByPaneKey: {} })
    const outcome = releaseResumeVaultRecord({
      paneKey: 'tab-1:leaf-1',
      agent: 'claude',
      providerSession: { key: 'session_id', id: 'sess-1' }
    })
    expect(outcome).toEqual({ released: false, reason: 'not-found' })
  })

  it('refuses when the pane key was reused by a different session since the caller last read it', () => {
    const fresh = makeRecord({ providerSession: { key: 'session_id', id: 'sess-fresh' } })
    useAppStore.setState({ sleepingAgentSessionsByPaneKey: { [fresh.paneKey]: fresh } })

    const outcome = releaseResumeVaultRecord({
      paneKey: fresh.paneKey,
      agent: 'claude',
      providerSession: { key: 'session_id', id: 'sess-stale' }
    })

    expect(outcome).toEqual({ released: false, reason: 'changed' })
    expect(useAppStore.getState().sleepingAgentSessionsByPaneKey[fresh.paneKey]).toEqual(fresh)
  })

  it('never releases a record whose agent is currently working, even re-checked at call time', () => {
    const record = makeRecord()
    useAppStore.setState({
      sleepingAgentSessionsByPaneKey: { [record.paneKey]: record },
      agentStatusByPaneKey: { [record.paneKey]: makeAgentStatusEntry({ state: 'working' }) }
    })

    const outcome = releaseResumeVaultRecord({
      paneKey: record.paneKey,
      agent: record.agent,
      providerSession: record.providerSession
    })

    expect(outcome).toEqual({ released: false, reason: 'currently-working' })
    expect(useAppStore.getState().sleepingAgentSessionsByPaneKey[record.paneKey]).toEqual(record)
  })

  it('never calls into any main-process API, so the on-disk transcript is never touched', () => {
    const apiSpy = vi.fn()
    const api = new Proxy(
      {},
      {
        get: (_target, prop) => {
          apiSpy(prop)
          return new Proxy(() => {}, { apply: () => apiSpy(prop) })
        }
      }
    )
    vi.stubGlobal('window', { api })

    const record = makeRecord()
    useAppStore.setState({ sleepingAgentSessionsByPaneKey: { [record.paneKey]: record } })

    const outcome = releaseResumeVaultRecord({
      paneKey: record.paneKey,
      agent: record.agent,
      providerSession: record.providerSession
    })

    expect(outcome).toEqual({ released: true })
    expect(apiSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

describe('releaseResumeVaultProjectRecords', () => {
  it('releases every non-working record for the project and skips the working ones', () => {
    const done = makeRecord({ paneKey: 'tab-1:leaf-1', providerSession: { key: 'session_id', id: 'a' } })
    const working = makeRecord({ paneKey: 'tab-1:leaf-2', providerSession: { key: 'session_id', id: 'b' } })
    const otherProject = makeRecord({
      paneKey: 'tab-2:leaf-1',
      worktreeId: 'repo1::/tmp/other',
      providerSession: { key: 'session_id', id: 'c' }
    })
    useAppStore.setState({
      sleepingAgentSessionsByPaneKey: {
        [done.paneKey]: done,
        [working.paneKey]: working,
        [otherProject.paneKey]: otherProject
      },
      agentStatusByPaneKey: { [working.paneKey]: makeAgentStatusEntry({ state: 'working' }) }
    })

    const result = releaseResumeVaultProjectRecords(
      'repo1::/tmp/wt',
      new Set([done.paneKey, working.paneKey])
    )

    expect(result.releasedPaneKeys).toEqual([done.paneKey])
    expect(result.skippedCurrentlyWorking).toEqual([working.paneKey])
    const state = useAppStore.getState()
    expect(state.sleepingAgentSessionsByPaneKey[done.paneKey]).toBeUndefined()
    expect(state.sleepingAgentSessionsByPaneKey[working.paneKey]).toEqual(working)
    expect(state.sleepingAgentSessionsByPaneKey[otherProject.paneKey]).toEqual(otherProject)
  })

  it('never sweeps a record that appeared after the confirm dialog was shown', () => {
    const shown = makeRecord({ paneKey: 'tab-1:leaf-1', providerSession: { key: 'session_id', id: 'a' } })
    const arrivedLate = makeRecord({
      paneKey: 'tab-1:leaf-2',
      providerSession: { key: 'session_id', id: 'b' }
    })
    useAppStore.setState({
      sleepingAgentSessionsByPaneKey: { [shown.paneKey]: shown, [arrivedLate.paneKey]: arrivedLate }
    })

    // The user only confirmed releasing `shown` — `arrivedLate` was never in the dialog's count.
    const result = releaseResumeVaultProjectRecords('repo1::/tmp/wt', new Set([shown.paneKey]))

    expect(result.releasedPaneKeys).toEqual([shown.paneKey])
    const state = useAppStore.getState()
    expect(state.sleepingAgentSessionsByPaneKey[shown.paneKey]).toBeUndefined()
    expect(state.sleepingAgentSessionsByPaneKey[arrivedLate.paneKey]).toEqual(arrivedLate)
  })
})

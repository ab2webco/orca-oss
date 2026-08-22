import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../shared/agent-status-types'
import { AGENT_STATUS_STALE_AFTER_MS } from '../../../shared/agent-status-types'
import type { SleepingAgentSessionRecord } from '../../../shared/agent-session-resume'
import type { RetainedAgentEntry } from '@/store/slices/agent-status'
import { TEST_REPO, makeWorktree } from '@/store/slices/store-test-helpers'
import {
  buildResumeVaultProjectGroups,
  getResumeVaultHeldReason,
  isSleepingAgentPaneCurrentlyWorking,
  resolveResumeVaultWorktreeIdentity,
  type ResumeVaultSourceState
} from './resume-vault-records'

function makeRecord(overrides: Partial<SleepingAgentSessionRecord> = {}): SleepingAgentSessionRecord {
  return {
    paneKey: 'tab-1:leaf-1',
    tabId: 'tab-1',
    worktreeId: 'repo1::/tmp/wt',
    agent: 'claude',
    providerSession: { key: 'session_id', id: 'sess-1' },
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

function baseState(overrides: Partial<ResumeVaultSourceState> = {}): ResumeVaultSourceState {
  return {
    sleepingAgentSessionsByPaneKey: {},
    worktreesByRepo: {},
    repos: [{ ...TEST_REPO, executionHostId: 'local' }],
    agentStatusByPaneKey: {},
    retainedAgentsByPaneKey: {},
    ...overrides
  }
}

describe('getResumeVaultHeldReason', () => {
  it('reports interrupted for a cancelled done state', () => {
    expect(getResumeVaultHeldReason({ state: 'done', interrupted: true })).toBe('interrupted')
  })

  it('reports finished for a done state with no interrupt flag', () => {
    expect(getResumeVaultHeldReason({ state: 'done', interrupted: false })).toBe('finished')
    expect(getResumeVaultHeldReason({ state: 'done' })).toBe('finished')
  })

  it('reports unknown when the captured state was still mid-turn', () => {
    expect(getResumeVaultHeldReason({ state: 'working' })).toBe('unknown')
    expect(getResumeVaultHeldReason({ state: 'blocked' })).toBe('unknown')
    expect(getResumeVaultHeldReason({ state: 'waiting' })).toBe('unknown')
  })
})

describe('isSleepingAgentPaneCurrentlyWorking', () => {
  it('is false with no live or retained status', () => {
    expect(isSleepingAgentPaneCurrentlyWorking('tab-1:leaf-1', baseState())).toBe(false)
  })

  it('is true when the live status is fresh and not done', () => {
    const state = baseState({
      agentStatusByPaneKey: { 'tab-1:leaf-1': makeAgentStatusEntry({ state: 'working' }) }
    })
    expect(isSleepingAgentPaneCurrentlyWorking('tab-1:leaf-1', state)).toBe(true)
  })

  it('is true when only the retained status is fresh and not done', () => {
    const retained: RetainedAgentEntry = {
      entry: makeAgentStatusEntry({ state: 'blocked' }),
      worktreeId: 'wt-1',
      tab: { id: 'tab-1' } as RetainedAgentEntry['tab'],
      agentType: 'claude',
      startedAt: Date.now()
    }
    const state = baseState({ retainedAgentsByPaneKey: { 'tab-1:leaf-1': retained } })
    expect(isSleepingAgentPaneCurrentlyWorking('tab-1:leaf-1', state)).toBe(true)
  })

  it('is false when a not-done live status has gone stale', () => {
    const now = Date.now()
    const state = baseState({
      agentStatusByPaneKey: {
        'tab-1:leaf-1': makeAgentStatusEntry({
          state: 'working',
          updatedAt: now - AGENT_STATUS_STALE_AFTER_MS - 1
        })
      }
    })
    expect(isSleepingAgentPaneCurrentlyWorking('tab-1:leaf-1', state, now)).toBe(false)
  })

  it('is false once the live status reports done', () => {
    const state = baseState({
      agentStatusByPaneKey: { 'tab-1:leaf-1': makeAgentStatusEntry({ state: 'done' }) }
    })
    expect(isSleepingAgentPaneCurrentlyWorking('tab-1:leaf-1', state)).toBe(false)
  })
})

describe('resolveResumeVaultWorktreeIdentity', () => {
  it('resolves an available worktree from the store', () => {
    const worktree = makeWorktree({
      id: 'repo1::/tmp/wt',
      repoId: 'repo1',
      path: '/tmp/wt',
      displayName: 'feature-branch',
      branch: 'refs/heads/feature'
    })
    const identity = resolveResumeVaultWorktreeIdentity('repo1::/tmp/wt', {
      worktreesByRepo: { repo1: [worktree] },
      repos: [{ ...TEST_REPO, executionHostId: 'local' }]
    })
    expect(identity).toMatchObject({
      isAvailable: true,
      repoDisplayName: TEST_REPO.displayName,
      worktreeDisplayName: 'feature-branch',
      worktreePath: '/tmp/wt',
      branch: 'refs/heads/feature'
    })
  })

  it('falls back to the parsed id when the worktree is gone from the store', () => {
    const identity = resolveResumeVaultWorktreeIdentity('repo1::/tmp/gone', {
      worktreesByRepo: {},
      repos: [{ ...TEST_REPO, executionHostId: 'local' }]
    })
    expect(identity).toMatchObject({
      isAvailable: false,
      repoDisplayName: TEST_REPO.displayName,
      worktreePath: '/tmp/gone'
    })
  })

  it('falls back further to the raw id when the repo is also unknown', () => {
    const identity = resolveResumeVaultWorktreeIdentity('missing-repo::/tmp/gone', {
      worktreesByRepo: {},
      repos: []
    })
    expect(identity.isAvailable).toBe(false)
    expect(identity.repoDisplayName).toBe('missing-repo')
    expect(identity.worktreePath).toBe('/tmp/gone')
  })
})

describe('buildResumeVaultProjectGroups', () => {
  it('groups records by project and carries identifying detail', () => {
    const worktreeA = makeWorktree({ id: 'repo1::/tmp/a', repoId: 'repo1', path: '/tmp/a' })
    const worktreeB = makeWorktree({ id: 'repo1::/tmp/b', repoId: 'repo1', path: '/tmp/b' })
    const state = baseState({
      worktreesByRepo: { repo1: [worktreeA, worktreeB] },
      sleepingAgentSessionsByPaneKey: {
        'tab-a:leaf-1': makeRecord({ paneKey: 'tab-a:leaf-1', worktreeId: 'repo1::/tmp/a' }),
        'tab-a:leaf-2': makeRecord({
          paneKey: 'tab-a:leaf-2',
          worktreeId: 'repo1::/tmp/a',
          updatedAt: 2_000
        }),
        'tab-b:leaf-1': makeRecord({ paneKey: 'tab-b:leaf-1', worktreeId: 'repo1::/tmp/b' })
      }
    })

    const groups = buildResumeVaultProjectGroups(state)

    expect(groups).toHaveLength(2)
    const groupA = groups.find((g) => g.worktreeId === 'repo1::/tmp/a')
    expect(groupA?.entries).toHaveLength(2)
    // newest capture first
    expect(groupA?.entries[0]?.paneKey).toBe('tab-a:leaf-2')
    expect(groupA?.identity.worktreePath).toBe('/tmp/a')
  })

  it('marks entries not currently working as releasable-eligible and vice versa', () => {
    const worktree = makeWorktree({ id: 'repo1::/tmp/a', repoId: 'repo1', path: '/tmp/a' })
    const state = baseState({
      worktreesByRepo: { repo1: [worktree] },
      sleepingAgentSessionsByPaneKey: {
        'tab-a:leaf-1': makeRecord({ paneKey: 'tab-a:leaf-1', worktreeId: 'repo1::/tmp/a' })
      },
      agentStatusByPaneKey: {
        'tab-a:leaf-1': makeAgentStatusEntry({ state: 'working' })
      }
    })

    const [group] = buildResumeVaultProjectGroups(state)
    expect(group?.entries[0]?.isCurrentlyWorking).toBe(true)
  })
})

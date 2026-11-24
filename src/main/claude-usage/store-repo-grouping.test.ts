import { describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../shared/repo-types'
import type {
  ClaudeUsageDailyAggregate,
  ClaudeUsageLocationBreakdown,
  ClaudeUsagePersistedState,
  ClaudeUsageSession
} from './types'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/orca-test-userdata' } }))

import { ClaudeUsageStore } from './store'

const REPO = { id: 'repo-1', path: '/work/orca', displayName: 'orca-oss' } as Repo

function daily(
  projectKey: string,
  label: string,
  repoId: string | null,
  tokens: Partial<ClaudeUsageDailyAggregate> = {}
): ClaudeUsageDailyAggregate {
  return {
    day: '2026-04-09',
    model: 'claude-sonnet-4-6',
    projectKey,
    projectLabel: label,
    repoId,
    worktreeId: repoId ? projectKey.replace('worktree:', '') : null,
    turnCount: 1,
    zeroCacheReadTurnCount: 0,
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 1000,
    cacheWriteTokens: 100,
    ...tokens
  }
}

function location(locationKey: string, repoId: string | null): ClaudeUsageLocationBreakdown {
  return {
    locationKey,
    projectLabel: locationKey,
    repoId,
    worktreeId: repoId ? locationKey.replace('worktree:', '') : null,
    turnCount: 1,
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 1000,
    cacheWriteTokens: 100
  }
}

function session(sessionId: string, locations: ClaudeUsageLocationBreakdown[]): ClaudeUsageSession {
  return {
    sessionId,
    firstTimestamp: '2026-04-09T10:00:00.000Z',
    lastTimestamp: '2026-04-09T10:10:00.000Z',
    model: 'claude-sonnet-4-6',
    lastCwd: null,
    lastGitBranch: null,
    primaryWorktreeId: locations[0]?.worktreeId ?? null,
    primaryRepoId: locations[0]?.repoId ?? null,
    turnCount: locations.length,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
    locationBreakdown: locations
  }
}

function createStore(state: Partial<ClaudeUsagePersistedState>): ClaudeUsageStore {
  const store = new ClaudeUsageStore({ getRepos: () => [REPO], getAllWorktreeMeta: () => ({}) })
  ;(store as unknown as { state: ClaudeUsagePersistedState }).state = {
    schemaVersion: 5,
    worktreeFingerprint: null,
    processedFiles: [],
    sessions: [],
    dailyAggregates: [],
    scanState: {
      enabled: false,
      lastScanStartedAt: null,
      lastScanCompletedAt: null,
      lastScanError: null
    },
    ...state
  }
  return store
}

describe('ClaudeUsageStore project breakdown by repo', () => {
  const wtA = 'worktree:repo-1::/work/orca'
  const wtB = 'worktree:repo-1::/work/orca-1382'

  it('adds every worktree of one repo into one row labelled with the repo name', () => {
    const store = createStore({
      dailyAggregates: [
        daily(wtA, 'main', 'repo-1'),
        daily(wtB, 'orca-1382', 'repo-1', { turnCount: 2 }),
        daily('cwd:/elsewhere/tool', 'elsewhere/tool', null)
      ],
      sessions: [
        session('s-both', [location(wtA, 'repo-1'), location(wtB, 'repo-1')]),
        session('s-b', [location(wtB, 'repo-1')]),
        session('s-out', [location('cwd:/elsewhere/tool', null)])
      ]
    })

    const { projectBreakdown, summary } = store.getSnapshot('all', 'all')

    expect(projectBreakdown.map((row) => row.label)).toEqual(['orca-oss', 'elsewhere/tool'])
    const repoRow = projectBreakdown[0]!
    expect(repoRow.turns).toBe(3)
    expect(repoRow.sessions).toBe(2)
    expect(repoRow.inputTokens).toBe(20)
    expect(repoRow.cacheReadTokens).toBe(2000)
    expect(projectBreakdown[1]!.sessions).toBe(1)
    expect(summary.topProject).toBe('orca-oss')
  })

  it('ranks rows and the top project by the full total including cache', () => {
    const store = createStore({
      dailyAggregates: [
        daily(wtA, 'main', 'repo-1', { inputTokens: 1, outputTokens: 1, cacheReadTokens: 9000 }),
        daily('cwd:/elsewhere/tool', 'elsewhere/tool', null, {
          inputTokens: 50,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0
        })
      ]
    })

    const { projectBreakdown, summary } = store.getSnapshot('all', 'all')

    expect(projectBreakdown.map((row) => row.label)).toEqual(['orca-oss', 'elsewhere/tool'])
    expect(summary.topProject).toBe('orca-oss')
  })
})

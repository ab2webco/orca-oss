import { describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../shared/repo-types'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/orca-test-userdata' } }))

import { CodexUsageStore } from '../codex-usage/store'
import { OpenCodeUsageStore } from '../opencode-usage/store'

const REPO = { id: 'repo-1', path: '/work/orca', displayName: 'orca-oss' } as Repo
const WT_A = 'worktree:repo-1::/work/orca'
const WT_B = 'worktree:repo-1::/work/orca-1382'
const OUTSIDE = 'cwd:/elsewhere/tool'

const tokens = {
  eventCount: 1,
  inputTokens: 100,
  cachedInputTokens: 80,
  outputTokens: 10,
  reasoningOutputTokens: 0,
  totalTokens: 110
}

function daily(projectKey: string, repoId: string | null) {
  return {
    day: '2026-04-09',
    model: 'gpt-5',
    projectKey,
    projectLabel: projectKey.split('/').at(-1)!,
    repoId,
    worktreeId: repoId ? projectKey.replace('worktree:', '') : null,
    ...tokens,
    hasInferredPricing: false,
    estimatedCostUsd: null
  }
}

function location(locationKey: string, repoId: string | null) {
  return {
    locationKey,
    projectLabel: locationKey,
    repoId,
    worktreeId: repoId ? locationKey.replace('worktree:', '') : null,
    ...tokens,
    hasInferredPricing: false,
    estimatedCostUsd: null
  }
}

function session(sessionId: string, locationKeys: [string, string | null][]) {
  const locations = locationKeys.map(([key, repoId]) => location(key, repoId))
  return {
    sessionId,
    firstTimestamp: '2026-04-09T10:00:00.000Z',
    lastTimestamp: '2026-04-09T10:10:00.000Z',
    primaryModel: 'gpt-5',
    hasMixedModels: false,
    primaryProjectLabel: 'x',
    hasMixedLocations: locations.length > 1,
    primaryWorktreeId: locations[0]?.worktreeId ?? null,
    primaryRepoId: locations[0]?.repoId ?? null,
    totalInputTokens: 0,
    totalCachedInputTokens: 0,
    totalOutputTokens: 0,
    totalReasoningOutputTokens: 0,
    totalTokens: 0,
    eventCount: locations.length,
    hasInferredPricing: false,
    estimatedCostUsd: null,
    locationBreakdown: locations,
    modelBreakdown: [],
    locationModelBreakdown: []
  }
}

const state = {
  schemaVersion: 0,
  worktreeFingerprint: null,
  processedFiles: [],
  processedDatabases: [],
  dailyAggregates: [daily(WT_A, 'repo-1'), daily(WT_B, 'repo-1'), daily(OUTSIDE, null)],
  sessions: [
    session('s-both', [
      [WT_A, 'repo-1'],
      [WT_B, 'repo-1']
    ]),
    session('s-b', [[WT_B, 'repo-1']]),
    session('s-out', [[OUTSIDE, null]])
  ],
  scanState: {
    enabled: false,
    lastScanStartedAt: null,
    lastScanCompletedAt: null,
    lastScanError: null
  }
}

describe.each([
  ['Codex', CodexUsageStore],
  ['OpenCode', OpenCodeUsageStore]
])('%s project breakdown by repo', (_name, StoreClass) => {
  it('adds the worktrees of one repo into one row and counts each session once', () => {
    const store = new StoreClass({ getRepos: () => [REPO], getAllWorktreeMeta: () => ({}) })
    ;(store as unknown as { state: unknown }).state = structuredClone(state)

    const { projectBreakdown, summary } = store.getSnapshot('all', 'all')

    expect(projectBreakdown.map((row) => row.label)).toEqual(['orca-oss', 'tool'])
    expect(projectBreakdown[0]).toMatchObject({ events: 2, sessions: 2, totalTokens: 220 })
    expect(projectBreakdown[1]).toMatchObject({ events: 1, sessions: 1, totalTokens: 110 })
    expect(summary.topProject).toBe('orca-oss')
  })
})

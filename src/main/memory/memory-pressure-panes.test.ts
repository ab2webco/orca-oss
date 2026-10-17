import { describe, expect, it } from 'vitest'
import type {
  MemorySnapshot,
  SessionMemory,
  WorktreeMemory
} from '../../shared/process-stats-types'
import { ORPHAN_WORKTREE_ID } from '../../shared/constants'
import { rankMemoryPressurePanes } from './memory-pressure-panes'

const MIB = 1024 ** 2

function session(id: string, memory: number, footprint?: number | null): SessionMemory {
  return {
    sessionId: id,
    paneKey: `tab-${id}:leaf-${id}`,
    pid: 1,
    cpu: 0,
    memory,
    ...(footprint === undefined ? {} : { footprint })
  }
}

function worktree(worktreeId: string, repoName: string, sessions: SessionMemory[]): WorktreeMemory {
  return {
    worktreeId,
    worktreeName: `${worktreeId}-name`,
    repoId: 'repo',
    repoName,
    cpu: 0,
    memory: 0,
    sessions,
    history: []
  }
}

function snapshot(
  worktrees: WorktreeMemory[],
  metric: MemorySnapshot['processMemoryMetric'] = 'rss'
): MemorySnapshot {
  return {
    app: {
      cpu: 0,
      memory: 0,
      main: { cpu: 0, memory: 0 },
      renderer: { cpu: 0, memory: 0 },
      other: { cpu: 0, memory: 0 },
      history: []
    },
    worktrees,
    host: {
      totalMemory: 0,
      freeMemory: 0,
      availableMemory: 0,
      availableMemorySource: 'free-memory',
      usedMemory: 0,
      memoryUsagePercent: 0,
      cpuCoreCount: 1,
      loadAverage1m: 0
    },
    processMemoryMetric: metric,
    totalCpu: 0,
    totalMemory: 0,
    collectedAt: 0
  }
}

describe('rankMemoryPressurePanes', () => {
  it('ranks by footprint when present, since RSS hides compressed memory', () => {
    const ranked = rankMemoryPressurePanes(
      snapshot([
        worktree('wt-a', 'cineco', [
          session('a', 900 * MIB, 1200 * MIB),
          session('b', 950 * MIB, 300 * MIB)
        ])
      ]),
      () => null,
      5
    )

    expect(ranked.map((pane) => [pane.sessionId, pane.memory, pane.metric])).toEqual([
      ['a', 1200 * MIB, 'phys-footprint'],
      ['b', 300 * MIB, 'phys-footprint']
    ])
  })

  it('falls back to the platform metric and keeps project and idle attribution', () => {
    const ranked = rankMemoryPressurePanes(
      snapshot(
        [
          worktree('wt-a', 'cineco', [session('a', 100 * MIB)]),
          // Why a folder workspace: its id is not a git worktree path, and it still ranks.
          worktree('folder::/Users/me/notes', 'notes', [session('b', 400 * MIB)])
        ],
        'working-set'
      ),
      (id) => (id === 'b' ? 1_700 : null),
      5
    )

    expect(ranked).toEqual([
      {
        sessionId: 'b',
        paneKey: 'tab-b:leaf-b',
        worktreeId: 'folder::/Users/me/notes',
        worktreeName: 'folder::/Users/me/notes-name',
        repoName: 'notes',
        memory: 400 * MIB,
        metric: 'working-set',
        lastOutputAt: 1_700
      },
      expect.objectContaining({ sessionId: 'a', metric: 'working-set', lastOutputAt: null })
    ])
  })

  it('drops empty sessions, caps the list and reports unattributed terminals with no worktree', () => {
    const ranked = rankMemoryPressurePanes(
      snapshot([
        worktree(ORPHAN_WORKTREE_ID, 'Other', [session('o', 50 * MIB), session('zero', 0)]),
        worktree('wt-a', 'cineco', [session('a', 70 * MIB), session('c', 60 * MIB)])
      ]),
      () => null,
      2
    )

    expect(ranked.map((pane) => pane.sessionId)).toEqual(['a', 'c'])
    expect(
      rankMemoryPressurePanes(
        snapshot([worktree(ORPHAN_WORKTREE_ID, 'Other', [session('o', 5)])]),
        () => null,
        5
      )[0].worktreeId
    ).toBeNull()
  })
})

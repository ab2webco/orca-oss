// ─── Stats ──────────────────────────────────────────────────────────

export type StatsSummary = {
  totalAgentsSpawned: number
  totalPRsCreated: number
  totalAgentTimeMs: number
  // Sourced from aggregates, not the event log, so it survives event trimming.
  firstEventAt: number | null // timestamp of first-ever event, for "tracking since..."
}

// ─── Memory dashboard ──────────────────────────────────────────────

/** cpu is percent of a single core — can exceed 100 on multi-core. memory is in bytes. */
export type UsageValues = {
  cpu: number
  memory: number
}

export type ProcessMemoryMetric = 'rss' | 'working-set'

/**
 * The second metric, reported next to `memory` and never in place of it: macOS
 * accounts a process by phys_footprint, which counts the compressed and swapped
 * pages `memory` loses, so the two diverge exactly as pressure rises. Swapping
 * the existing field would silently invalidate every number already recorded
 * against it (ORCA-325).
 */
export type ProcessFootprintMetric = 'phys-footprint'

export type HostAvailableMemorySource = 'memory-pressure' | 'proc-meminfo' | 'free-memory'

/** The top-level cpu/memory are the sum of main + renderer + other. */
export type AppMemory = UsageValues & {
  main: UsageValues
  renderer: UsageValues
  other: UsageValues
  /** Oldest-first memory samples (bytes) for the whole Orca app; empty before the first snapshot. */
  history: number[]
}

export type SessionMemory = UsageValues & {
  sessionId: string
  paneKey: string | null
  pid: number
}

/** The top-level cpu/memory are the sum of sessions. */
export type WorktreeMemory = UsageValues & {
  worktreeId: string
  worktreeName: string
  repoId: string
  repoName: string
  sessions: SessionMemory[]
  /** Oldest-first memory samples (bytes) for this worktree's tracked subtrees. */
  history: number[]
}

export type HostMemory = {
  totalMemory: number
  /** Immediately free memory reported by Node's host API. */
  freeMemory: number
  /** Memory available without material pressure, or freeMemory when unavailable. */
  availableMemory: number
  availableMemorySource: HostAvailableMemorySource
  /** totalMemory - availableMemory. */
  usedMemory: number
  memoryUsagePercent: number
  cpuCoreCount: number
  loadAverage1m: number
}

export type MemorySnapshot = {
  app: AppMemory
  worktrees: WorktreeMemory[]
  host: HostMemory
  /** Per-process byte metric used by app, session, worktree, history, and totalMemory values. */
  processMemoryMetric: ProcessMemoryMetric
  /**
   * Names the metric the footprint fields carry, or null where the platform has
   * no equivalent.
   *
   * Why optional and not required: this snapshot crosses the paired client-to-host
   * boundary, where mixed versions are the normal state. A host predating these
   * fields sends none of them, and a reader that required them would be broken
   * against every such host — Rule 1 of docs/reference/remote-wire-compatibility.md.
   * Absent means the same as null: this producer reports no footprint.
   */
  processFootprintMetric?: ProcessFootprintMetric | null
  /** Sum of the footprint metric over the app's own processes. Null when unavailable — never 0. */
  appFootprint?: number | null
  /** Sum of the footprint metric over app plus every tracked session. Null when unavailable. */
  totalFootprint?: number | null
  /** Sum of app + all tracked worktree sessions. Percent of a single core, so may exceed 100 on multi-core machines. */
  totalCpu: number
  /** Sum of per-process samples. Shared pages may repeat, so this can exceed host.totalMemory. */
  totalMemory: number
  collectedAt: number
}

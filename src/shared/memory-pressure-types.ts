export type MemoryPressureKernelLevel = 'normal' | 'warn' | 'critical'

export type MemoryPressureReading = {
  totalMemory: number
  availableMemory: number
  /** Null where the platform reports no swap figure (Windows). */
  swapTotal: number | null
  swapUsed: number | null
  /** macOS kernel memory-pressure level; null on other platforms. */
  kernelLevel: MemoryPressureKernelLevel | null
  readAt: number
}

/** phys-footprint on macOS; otherwise the collector's per-process metric. */
export type MemoryPressurePaneMetric = 'phys-footprint' | 'rss' | 'working-set'

export type MemoryPressurePane = {
  /** The PTY id the Resource Manager kills and the renderer binds to a tab. */
  sessionId: string
  paneKey: string | null
  /** Null for terminals the collector could not attribute to a worktree. */
  worktreeId: string | null
  worktreeName: string
  repoName: string
  memory: number
  metric: MemoryPressurePaneMetric
  /** Null until the PTY prints something in this app session: idle time is unknown. */
  lastOutputAt: number | null
}

export type MemoryPressureWarning = {
  episodeId: number
  reading: MemoryPressureReading
  panes: MemoryPressurePane[]
  /** True while the per-pane sweep for this episode is still running. */
  sweeping: boolean
}

export type MemoryPressureState = {
  warning: MemoryPressureWarning | null
}

export type MemoryPressureKernelLevel = 'normal' | 'warn' | 'critical'

/** sysctl (macOS) and meminfo (Linux) are the platform readers; freemem is Windows' normal
 *  figure; fallback is os.freemem() after a platform read failed and is never trusted. */
export type MemoryPressureReadingSource = 'sysctl' | 'meminfo' | 'freemem' | 'fallback'

export type MemoryPressureReading = {
  totalMemory: number
  availableMemory: number
  /** Null where the platform reports no swap figure (Windows). */
  swapTotal: number | null
  swapUsed: number | null
  /** macOS kernel memory-pressure level; null on other platforms. */
  kernelLevel: MemoryPressureKernelLevel | null
  source: MemoryPressureReadingSource
  readAt: number
}

/** What opened the popup: a sustained kernel signal, sustained low memory where there is no
 *  kernel signal, or a falling trend that runs out soon. */
export type MemoryPressureTrigger = 'kernel-pressure' | 'low-memory' | 'exhaustion-predicted'

/** phys-footprint on macOS; otherwise the collector's per-process metric. */
export type MemoryPressurePaneMetric = 'phys-footprint' | 'rss' | 'working-set'

export type MemoryPressurePane = {
  /** The collector's session key (registry session id, else PTY id). */
  sessionId: string
  /** Live PTY id: what a tab binds, idle time is keyed by, and Close kills. */
  ptyId: string
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
  trigger: MemoryPressureTrigger
  /** Minutes until memory runs out at the current rate; null when it is not falling. */
  minutesToExhaustion: number | null
  panes: MemoryPressurePane[]
  /** True while the per-pane sweep for this episode is still running. */
  sweeping: boolean
}

export type MemoryPressureState = {
  warning: MemoryPressureWarning | null
}

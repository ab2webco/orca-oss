/** Result of one git progress reading for a worktree, as it crosses main -> renderer. */
export type WorktreeProgressProbeResult =
  | { kind: 'fingerprint'; value: string }
  /** Git could not be read this tick. Never means "unchanged". */
  | { kind: 'unreadable' }
  /** Folder workspaces have no git, so there is no progress to measure. */
  | { kind: 'unsupported'; reason: 'folder-workspace' }

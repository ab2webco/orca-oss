/** Result of one git progress reading for a worktree, as it crosses main -> renderer. */
export type WorktreeProgressProbeResult =
  | { kind: 'fingerprint'; value: string }
  /** Git could not be read this tick. Never means "unchanged". */
  | { kind: 'unreadable' }
  /** No progress can be measured here at all, so an armed timer would never fire. */
  | { kind: 'unsupported'; reason: 'folder-workspace' | 'remote-workspace' }

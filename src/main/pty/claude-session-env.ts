const CLAUDE_SESSION_MARKER_ENV_KEYS = [
  'CLAUDECODE',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_ENTRYPOINT',
  // Why: also stripped by the prior downstream #9961 fix; kept here so the
  // spawn-site strip is the single source of truth and no marker regresses.
  'CLAUDE_CODE_BRIDGE_SESSION_ID'
] as const

/** Return a copy of an inherited environment without Claude Code session markers. */
export function stripInheritedClaudeSessionEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // Why: an Orca launched from inside a Claude Code session inherits that
  // session's markers, and a spawned Orca terminal is not a Claude child
  // session — the leaked marker makes `claude` there disable transcript
  // saving. Caller/renderer env and shell rc still win.
  const next = { ...env }
  for (const key of CLAUDE_SESSION_MARKER_ENV_KEYS) {
    delete next[key]
  }
  return next
}

/**
 * Which Claude universe a transcript belongs to, read from its own path.
 *
 * Why: Claude Code writes a conversation to `<CLAUDE_CONFIG_DIR>/projects/`, and
 * Orca gives each managed account its own config dir. Resuming a session against
 * a different universe hands the CLI an id that directory does not hold, and it
 * answers "No conversation found with session ID". The transcript's own path is
 * the only self-describing evidence of where it belongs.
 */
export type ClaudeTranscriptUniverse =
  | { kind: 'managed-account'; accountId: string }
  | { kind: 'shared-home' }
  | { kind: 'unknown' }

const MANAGED_SEGMENT = 'claude-accounts'
const AUTH_SEGMENT = 'auth'
const PROJECTS_SEGMENT = 'projects'

/**
 * `…/claude-accounts/<accountId>/auth/projects/<slug>/<id>.jsonl` is a managed
 * vault; anything else under a `projects/` directory is the shared home.
 *
 * Returns `unknown` rather than guessing when the path is not a Claude
 * transcript layout at all — a caller must not pin a launch on a guess.
 */
export function resolveClaudeTranscriptUniverse(filePath: string): ClaudeTranscriptUniverse {
  const segments = filePath.split(/[\\/]/).filter((segment) => segment.length > 0)
  const projectsIndex = segments.lastIndexOf(PROJECTS_SEGMENT)
  if (projectsIndex <= 0) {
    return { kind: 'unknown' }
  }
  if (
    segments[projectsIndex - 1] === AUTH_SEGMENT &&
    segments[projectsIndex - 3] === MANAGED_SEGMENT
  ) {
    const accountId = segments[projectsIndex - 2]
    return accountId ? { kind: 'managed-account', accountId } : { kind: 'unknown' }
  }
  return { kind: 'shared-home' }
}

/**
 * The account a resumed launch must run against, or null for the shared home.
 * `unknown` universes yield null too: the caller keeps the worktree's own pin
 * rather than redirecting a launch it cannot justify.
 */
export function resolveClaudeResumeAccountId(filePath: string): string | null {
  const universe = resolveClaudeTranscriptUniverse(filePath)
  return universe.kind === 'managed-account' ? universe.accountId : null
}

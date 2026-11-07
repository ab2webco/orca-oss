import type { AgentProviderSessionMetadata } from '../../shared/agent-session-resume'
import { resolveClaudeTranscriptUniverse } from '../../shared/claude-transcript-universe'

export const CLAUDE_RESUME_ACCOUNT_REMOVED_MESSAGE =
  'The Claude account that owns this conversation was removed. Add that account again in Settings to resume it.'

/**
 * The account a Claude spawn runs on: the caller's launch account, else the one that owns the
 * resumed transcript. Undefined keeps the worktree pin and global selection.
 *
 * Why: a restored or woken pane resumes with a fresh PTY whose old account binding is gone, so
 * without this it fell to the global login and lost its conversation (ORCA-718).
 */
export function resolveClaudeLaunchAccountForSpawn(args: {
  launchAccountId: string | null | undefined
  resumeProviderSession: AgentProviderSessionMetadata | undefined
  hasManagedAccount: (accountId: string) => boolean
}): string | null | undefined {
  if (args.launchAccountId !== undefined) {
    return args.launchAccountId
  }
  const transcriptPath = args.resumeProviderSession?.transcriptPath
  if (!transcriptPath) {
    return undefined
  }
  const universe = resolveClaudeTranscriptUniverse(transcriptPath)
  if (universe.kind === 'shared-home') {
    return null
  }
  if (universe.kind === 'unknown') {
    return undefined
  }
  if (!args.hasManagedAccount(universe.accountId)) {
    // Why refuse: any other account answers "No conversation found" or runs on the wrong login.
    throw new Error(CLAUDE_RESUME_ACCOUNT_REMOVED_MESSAGE)
  }
  return universe.accountId
}

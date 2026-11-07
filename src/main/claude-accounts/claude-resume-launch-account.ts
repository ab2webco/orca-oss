import type { AgentProviderSessionMetadata } from '../../shared/agent-session-resume'
import { resolveClaudeTranscriptUniverse } from '../../shared/claude-transcript-universe'
import type { ClaudeResumeSessionLocation } from './claude-resume-session-location'

export const CLAUDE_RESUME_SESSION_MISSING_MESSAGE =
  'Orca could not find this Claude conversation in its transcript store or in any Claude account, so no account can resume it.'

/** A launch account, null for the shared home, or undefined to keep the pin and global selection. */
export type ClaudeLaunchAccount = string | null | undefined

/**
 * The account a Claude spawn runs on: the caller's launch account, else the existing account whose
 * vault the resumed transcript lives under, else what a new launch in the worktree would get.
 *
 * Why the new-launch account is safe: every linked universe reads one shared transcript store, so
 * any account resumes a conversation in it, a removed account's included (ORCA-718). A universe
 * whose link was skipped is the only one that can read what it keeps, so such a conversation runs
 * there; only one no account can read is refused.
 */
export function resolveClaudeLaunchAccountForSpawn(args: {
  launchAccountId: string | null | undefined
  resumeProviderSession: AgentProviderSessionMetadata | undefined
  hasManagedAccount: (accountId: string) => boolean
  /** Absent where this host's universes do not hold the conversation (WSL, SSH). */
  locateSession?: (session: AgentProviderSessionMetadata) => Promise<ClaudeResumeSessionLocation>
}): ClaudeLaunchAccount | Promise<ClaudeLaunchAccount> {
  const session = args.resumeProviderSession
  if (args.launchAccountId !== undefined || !session) {
    return args.launchAccountId
  }
  const universe = session.transcriptPath
    ? resolveClaudeTranscriptUniverse(session.transcriptPath)
    : null
  if (universe?.kind === 'managed-account' && args.hasManagedAccount(universe.accountId)) {
    return universe.accountId
  }
  if (!args.locateSession) {
    return undefined
  }
  // Why the only promise: every other spawn must not wait a tick on this.
  return accountOfLocation(args.locateSession(session))
}

async function accountOfLocation(
  location: Promise<ClaudeResumeSessionLocation>
): Promise<ClaudeLaunchAccount> {
  const found = await location
  if (found.kind === 'missing') {
    throw new Error(CLAUDE_RESUME_SESSION_MISSING_MESSAGE)
  }
  return found.kind === 'universe' ? found.accountId : undefined
}

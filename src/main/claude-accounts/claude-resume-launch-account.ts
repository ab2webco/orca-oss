import type { AgentProviderSessionMetadata } from '../../shared/agent-session-resume'
import { resolveClaudeTranscriptUniverse } from '../../shared/claude-transcript-universe'
import type { ClaudeSessionLookupResult } from './claude-resume-session-lookup'

export const CLAUDE_RESUME_ACCOUNT_REMOVED_MESSAGE =
  'The Claude account that owns this conversation was removed. Add that account again in Settings to resume it.'

export const CLAUDE_RESUME_SESSION_MISSING_MESSAGE =
  'Orca could not find this Claude conversation under any Claude account, so it did not start it on the default login. Open it from Agent Session History to resume it.'

export function claudeResumeAmbiguousMessage(labels: readonly string[]): string {
  return `This Claude conversation is stored under more than one Claude account (${labels.join(', ')}), so Orca did not choose one. Open it from Agent Session History and pick the account to resume it.`
}

/** A launch account, null for the shared home, or undefined to keep the pin and global selection. */
export type ClaudeLaunchAccount = string | null | undefined

// Why: every universe's `projects/` links to this store, so a path inside it names no account.
const SHARED_TRANSCRIPT_STORE_SEGMENT = 'claude-transcripts'

function transcriptVerdict(transcriptPath: string | undefined) {
  if (!transcriptPath) {
    return { kind: 'unknown' } as const
  }
  const segments = transcriptPath.split(/[\\/]/).filter(Boolean)
  const projectsIndex = segments.lastIndexOf('projects')
  if (segments[projectsIndex - 1] === SHARED_TRANSCRIPT_STORE_SEGMENT) {
    return { kind: 'unknown' } as const
  }
  return resolveClaudeTranscriptUniverse(transcriptPath)
}

/**
 * The account a Claude spawn runs on: the caller's launch account, else the one that owns the
 * resumed conversation. Undefined keeps the worktree pin and global selection.
 *
 * Why: a restored or woken pane resumes with a fresh PTY whose old account binding is gone, so
 * without this it fell to the global login and lost its conversation (ORCA-718).
 */
export function resolveClaudeLaunchAccountForSpawn(args: {
  launchAccountId: string | null | undefined
  resumeProviderSession: AgentProviderSessionMetadata | undefined
  hasManagedAccount: (accountId: string) => boolean
  /** Finds the session by id when its transcript path gives no verdict; absent where the
   *  conversation lives outside this host's universes (WSL, SSH). */
  findSessionUniverse?: (sessionId: string) => Promise<ClaudeSessionLookupResult>
  labelOf?: (accountId: string | null) => string
}): ClaudeLaunchAccount | Promise<ClaudeLaunchAccount> {
  if (args.launchAccountId !== undefined || !args.resumeProviderSession) {
    return args.launchAccountId
  }
  const universe = transcriptVerdict(args.resumeProviderSession.transcriptPath)
  if (universe.kind === 'shared-home') {
    return null
  }
  if (universe.kind === 'managed-account') {
    if (!args.hasManagedAccount(universe.accountId)) {
      // Why refuse: any other account answers "No conversation found" or runs on the wrong login.
      throw new Error(CLAUDE_RESUME_ACCOUNT_REMOVED_MESSAGE)
    }
    return universe.accountId
  }
  if (!args.findSessionUniverse) {
    return undefined
  }
  // Why only now, and the only promise: a record kept before transcript paths were stored
  // carries the id alone, and every other spawn must not wait a tick on this.
  return accountOfLookup(
    args.findSessionUniverse(args.resumeProviderSession.id),
    args.labelOf ?? ((accountId) => accountId ?? 'the default login')
  )
}

async function accountOfLookup(
  lookup: Promise<ClaudeSessionLookupResult>,
  labelOf: (accountId: string | null) => string
): Promise<ClaudeLaunchAccount> {
  const found = await lookup
  if (found.kind === 'found') {
    return found.accountId
  }
  if (found.kind === 'missing') {
    throw new Error(CLAUDE_RESUME_SESSION_MISSING_MESSAGE)
  }
  throw new Error(claudeResumeAmbiguousMessage(found.accountIds.map(labelOf)))
}

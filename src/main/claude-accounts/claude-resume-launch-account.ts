import type { AgentProviderSessionMetadata } from '../../shared/agent-session-resume'
import { resolveClaudeTranscriptUniverse } from '../../shared/claude-transcript-universe'
import type { SharedStoreSessionVerdict } from './claude-shared-store-session'

export const CLAUDE_RESUME_SESSION_MISSING_MESSAGE =
  'Orca could not find this Claude conversation in its transcript store, so no Claude account can resume it.'

/** A launch account, null for the shared home, or undefined to keep the pin and global selection. */
export type ClaudeLaunchAccount = string | null | undefined

/**
 * The account a Claude spawn runs on: the caller's launch account, else the existing account whose
 * vault the resumed transcript lives under, else what a new launch in the worktree would get.
 *
 * Why the new-launch account is safe: every universe links `projects/` to one shared transcript
 * store, so any account resumes any conversation in it, a removed account's included (ORCA-718).
 * Only a conversation missing from the store is refused, since then no account can resume it.
 */
export function resolveClaudeLaunchAccountForSpawn(args: {
  launchAccountId: string | null | undefined
  resumeProviderSession: AgentProviderSessionMetadata | undefined
  hasManagedAccount: (accountId: string) => boolean
  /** Absent where the store is not this host's (WSL, SSH): the new-launch account stands. */
  findInSharedStore?: (session: AgentProviderSessionMetadata) => Promise<SharedStoreSessionVerdict>
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
  if (!args.findInSharedStore) {
    return undefined
  }
  // Why the only promise: every other spawn must not wait a tick on this.
  return newLaunchAccountIfStored(args.findInSharedStore(session))
}

async function newLaunchAccountIfStored(
  verdict: Promise<SharedStoreSessionVerdict>
): Promise<ClaudeLaunchAccount> {
  if ((await verdict) === 'missing') {
    throw new Error(CLAUDE_RESUME_SESSION_MISSING_MESSAGE)
  }
  return undefined
}

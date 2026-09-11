import type { ClaudeManagedAccount } from '../../shared/types'
import { resolveOwnedClaudeManagedAuthPath } from './managed-auth-path'
import {
  findSessionProjectDir,
  resolveProjectsDir,
  resolveRealRoot
} from './session-transcript-location'
import type { ClaudeSessionFailoverDeps } from './session-failover'

// Why: the session id becomes a filename prefix; anything outside this shape
// could traverse or hide files.
export const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,511}$/

export type SourceRootResolution =
  | { ok: true; root: string }
  | { ok: false; reason: 'source-account-not-found' | 'source-dir-unresolved' }

export function resolveManagedSourceRoot(
  account: ClaudeManagedAccount | undefined
): SourceRootResolution {
  if (!account) {
    return { ok: false, reason: 'source-account-not-found' }
  }
  // Why: WSL universes live on a different filesystem; host-side copy would silently produce wrong paths.
  if (account.managedAuthRuntime === 'wsl') {
    return { ok: false, reason: 'source-dir-unresolved' }
  }
  const root = resolveOwnedClaudeManagedAuthPath(account.id, account.managedAuthPath)
  return root ? { ok: true, root } : { ok: false, reason: 'source-dir-unresolved' }
}

/** Universe a session's transcript is read from: the pinned account's, or shared ~/.claude. */
export function resolveSwitchSourceRoot(
  sourceAccountId: string | null | undefined,
  accounts: readonly ClaudeManagedAccount[],
  deps: ClaudeSessionFailoverDeps
): SourceRootResolution {
  if (typeof sourceAccountId === 'string' && sourceAccountId.length > 0) {
    return resolveManagedSourceRoot(accounts.find((account) => account.id === sourceAccountId))
  }
  const shared = resolveRealRoot(deps.getSharedConfigDir())
  return shared ? { ok: true, root: shared } : { ok: false, reason: 'source-dir-unresolved' }
}

/** Why the split: `absent` proves the session has no transcript, `unresolved` proves nothing. */
type SourceTranscriptLookup =
  | { status: 'found'; canonicalProjectsRoot: string; dirName: string; dirPath: string }
  | { status: 'absent'; canonicalProjectsRoot: string }
  | { status: 'unresolved' }

/** Source half of the copy, shared so the presence probe cannot look somewhere else. */
export function findSourceSessionTranscript(args: {
  sourceRoot: string
  cwd: string
  sessionId: string
  sharedTranscriptsRoot: string
}): SourceTranscriptLookup {
  const projects = resolveProjectsDir(args.sourceRoot, args.sharedTranscriptsRoot)
  if (projects.status !== 'resolved') {
    return { status: 'unresolved' }
  }
  const project = findSessionProjectDir(projects.canonicalRoot, args.cwd, args.sessionId)
  return project
    ? {
        status: 'found',
        canonicalProjectsRoot: projects.canonicalRoot,
        dirName: project.dirName,
        dirPath: project.dirPath
      }
    : { status: 'absent', canonicalProjectsRoot: projects.canonicalRoot }
}

export type ClaudeSessionTranscriptPresenceArgs = {
  sessionId: string
  cwd: string
  /** Managed account whose universe hosts the session; null/undefined = shared ~/.claude. */
  sourceAccountId?: string | null
}

/**
 * Whether the source universe already holds a transcript for this session.
 *
 * Why: a session nothing has written yet has no conversation to resume, and
 * letting the switch discover that mid-transaction produced a failure that read
 * like the conversation had been lost. Every uncertainty answers `true`, because
 * a wrong `false` withdraws a switch that would have worked.
 */
export function hasClaudeSessionTranscript(
  args: ClaudeSessionTranscriptPresenceArgs,
  deps: ClaudeSessionFailoverDeps
): boolean {
  const sessionId = args.sessionId.trim()
  if (!SESSION_ID_PATTERN.test(sessionId) || sessionId.includes('..')) {
    return true
  }
  const source = resolveSwitchSourceRoot(args.sourceAccountId, deps.getAccounts(), deps)
  if (!source.ok) {
    return true
  }
  return (
    findSourceSessionTranscript({
      sourceRoot: source.root,
      cwd: args.cwd,
      sessionId,
      sharedTranscriptsRoot: deps.getSharedTranscriptsRoot()
    }).status !== 'absent'
  )
}

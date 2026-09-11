import { chmodSync, copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ClaudeManagedAccount } from '../../shared/types'
import type { ClaudeSessionFailoverCopyResult } from '../../shared/managed-account-types'
import { resolveOwnedClaudeManagedAuthPath } from './managed-auth-path'
import {
  findSessionProjectDir,
  isInsideRoot,
  isParkedTranscriptDuplicate,
  isRealFile,
  isSamePath,
  resolveProjectsDir,
  resolveRealRoot
} from './session-transcript-location'

export { encodeClaudeProjectDirName } from './session-transcript-location'

// Why: the session id becomes a filename prefix; anything outside this shape could traverse or hide files.
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,511}$/

export type CopyClaudeSessionForFailoverArgs = {
  sessionId: string
  cwd: string
  targetAccountId: string
  /** Managed account whose universe hosted the limited session; null/undefined = shared ~/.claude. */
  sourceAccountId?: string | null
}

export type CopyClaudeSessionForFailBackArgs = {
  sessionId: string
  cwd: string
  /** Custom-endpoint account whose universe hosts the failed-over session. */
  sourceAccountId: string
  /** Origin account to return the transcript to; null = shared ~/.claude. */
  targetAccountId: string | null
}

export type CopyClaudeSessionForAccountSwitchArgs = {
  sessionId: string
  cwd: string
  /** Managed OAuth (non-endpoint) account receiving the transcript. */
  targetAccountId: string
  /** Managed account whose universe hosted the session; null/undefined = shared ~/.claude. */
  sourceAccountId?: string | null
}

export type ClaudeSessionFailoverDeps = {
  getAccounts(): readonly ClaudeManagedAccount[]
  /** Shared Claude config dir (~/.claude or CLAUDE_CONFIG_DIR) used when the source session is unpinned. */
  getSharedConfigDir(): string
  /** Orca's own transcript store — the single link target a universe's `projects/` may legitimately point at. */
  getSharedTranscriptsRoot(): string
}

type SourceRootResolution =
  | { ok: true; root: string }
  | { ok: false; reason: 'source-account-not-found' | 'source-dir-unresolved' }

function resolveManagedSourceRoot(account: ClaudeManagedAccount | undefined): SourceRootResolution {
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
function resolveSwitchSourceRoot(
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
function findSourceSessionTranscript(args: {
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

/**
 * Copies a Claude session transcript (plus same-session-id sidecar files) from
 * the source universe (shared ~/.claude or a pinned account) into a
 * custom-endpoint account's universe so `claude --resume` finds it there.
 */
export function copyClaudeSessionForFailover(
  args: CopyClaudeSessionForFailoverArgs,
  deps: ClaudeSessionFailoverDeps
): ClaudeSessionFailoverCopyResult {
  const sessionId = args.sessionId.trim()
  if (!SESSION_ID_PATTERN.test(sessionId) || sessionId.includes('..')) {
    return { ok: false, reason: 'invalid-session-id' }
  }

  const accounts = deps.getAccounts()
  const targetAccount = accounts.find((account) => account.id === args.targetAccountId)
  // Why: only custom-endpoint universes may receive failover copies; anything else risks polluting OAuth account state.
  if (!targetAccount || targetAccount.authMethod !== 'custom-endpoint') {
    return { ok: false, reason: 'target-account-not-found' }
  }
  if (targetAccount.managedAuthRuntime === 'wsl') {
    return { ok: false, reason: 'target-dir-unresolved' }
  }
  const targetRoot = resolveOwnedClaudeManagedAuthPath(
    targetAccount.id,
    targetAccount.managedAuthPath
  )
  if (!targetRoot) {
    return { ok: false, reason: 'target-dir-unresolved' }
  }

  let sourceRoot: string
  if (typeof args.sourceAccountId === 'string' && args.sourceAccountId.length > 0) {
    const resolved = resolveManagedSourceRoot(
      accounts.find((account) => account.id === args.sourceAccountId)
    )
    if (!resolved.ok) {
      return { ok: false, reason: resolved.reason }
    }
    sourceRoot = resolved.root
  } else {
    const shared = resolveRealRoot(deps.getSharedConfigDir())
    if (!shared) {
      return { ok: false, reason: 'source-dir-unresolved' }
    }
    sourceRoot = shared
  }

  return copySessionFilesBetweenRoots({
    sourceRoot,
    targetRoot,
    cwd: args.cwd,
    sessionId,
    sharedTranscriptsRoot: deps.getSharedTranscriptsRoot()
  })
}

/**
 * Copies a failed-over session transcript back OUT of a custom-endpoint
 * universe into the origin account's universe (or shared ~/.claude) once the
 * origin recovers quota, so `claude --resume` finds it at home again.
 */
export function copyClaudeSessionForFailBack(
  args: CopyClaudeSessionForFailBackArgs,
  deps: ClaudeSessionFailoverDeps
): ClaudeSessionFailoverCopyResult {
  const sessionId = args.sessionId.trim()
  if (!SESSION_ID_PATTERN.test(sessionId) || sessionId.includes('..')) {
    return { ok: false, reason: 'invalid-session-id' }
  }

  const accounts = deps.getAccounts()
  const sourceAccount = accounts.find((account) => account.id === args.sourceAccountId)
  // Why: only custom-endpoint universes may be a fail-back source — the mirror
  // of the forward guard, so this path can never shuttle OAuth-universe state.
  if (!sourceAccount || sourceAccount.authMethod !== 'custom-endpoint') {
    return { ok: false, reason: 'source-account-not-found' }
  }
  const resolvedSource = resolveManagedSourceRoot(sourceAccount)
  if (!resolvedSource.ok) {
    return { ok: false, reason: resolvedSource.reason }
  }

  let targetRoot: string
  if (typeof args.targetAccountId === 'string' && args.targetAccountId.length > 0) {
    const targetAccount = accounts.find((account) => account.id === args.targetAccountId)
    // Why: fail-back returns to a real origin; an endpoint target would be a
    // sideways copy this flow was never meant to perform.
    if (!targetAccount || targetAccount.authMethod === 'custom-endpoint') {
      return { ok: false, reason: 'target-account-not-found' }
    }
    if (targetAccount.managedAuthRuntime === 'wsl') {
      return { ok: false, reason: 'target-dir-unresolved' }
    }
    const resolved = resolveOwnedClaudeManagedAuthPath(
      targetAccount.id,
      targetAccount.managedAuthPath
    )
    if (!resolved) {
      return { ok: false, reason: 'target-dir-unresolved' }
    }
    targetRoot = resolved
  } else {
    const shared = resolveRealRoot(deps.getSharedConfigDir())
    if (!shared) {
      return { ok: false, reason: 'target-dir-unresolved' }
    }
    targetRoot = shared
  }

  return copySessionFilesBetweenRoots({
    sourceRoot: resolvedSource.root,
    targetRoot,
    cwd: args.cwd,
    sessionId,
    sharedTranscriptsRoot: deps.getSharedTranscriptsRoot()
  })
}

/**
 * Copies a Claude session transcript (plus same-session-id sidecars) between two
 * managed OAuth universes — or from shared ~/.claude into a pinned account — so
 * switching a pinned worktree to another Claude account keeps `claude --resume`
 * working there. This is the managed→managed sibling of the endpoint failover
 * copy: the target here must be an OAuth account (endpoint switches own their own
 * guarded path via copyClaudeSessionForFailover).
 */
export function copyClaudeSessionForAccountSwitch(
  args: CopyClaudeSessionForAccountSwitchArgs,
  deps: ClaudeSessionFailoverDeps
): ClaudeSessionFailoverCopyResult {
  const sessionId = args.sessionId.trim()
  if (!SESSION_ID_PATTERN.test(sessionId) || sessionId.includes('..')) {
    return { ok: false, reason: 'invalid-session-id' }
  }

  const accounts = deps.getAccounts()
  const targetAccount = accounts.find((account) => account.id === args.targetAccountId)
  // Why: transcripts belong in an OAuth account's own vault; a custom-endpoint target is the failover path, not this one.
  if (!targetAccount || targetAccount.authMethod === 'custom-endpoint') {
    return { ok: false, reason: 'target-account-not-found' }
  }
  if (targetAccount.managedAuthRuntime === 'wsl') {
    return { ok: false, reason: 'target-dir-unresolved' }
  }
  const targetRoot = resolveOwnedClaudeManagedAuthPath(
    targetAccount.id,
    targetAccount.managedAuthPath
  )
  if (!targetRoot) {
    return { ok: false, reason: 'target-dir-unresolved' }
  }

  const source = resolveSwitchSourceRoot(args.sourceAccountId, accounts, deps)
  if (!source.ok) {
    return { ok: false, reason: source.reason }
  }

  return copySessionFilesBetweenRoots({
    sourceRoot: source.root,
    targetRoot,
    cwd: args.cwd,
    sessionId,
    sharedTranscriptsRoot: deps.getSharedTranscriptsRoot()
  })
}

function copySessionFilesBetweenRoots(args: {
  sourceRoot: string
  targetRoot: string
  cwd: string
  sessionId: string
  sharedTranscriptsRoot: string
}): ClaudeSessionFailoverCopyResult {
  const sourceProject = findSourceSessionTranscript({
    sourceRoot: args.sourceRoot,
    cwd: args.cwd,
    sessionId: args.sessionId,
    sharedTranscriptsRoot: args.sharedTranscriptsRoot
  })
  if (sourceProject.status === 'unresolved') {
    return { ok: false, reason: 'source-not-found' }
  }
  const targetProjects = resolveProjectsDir(args.targetRoot, args.sharedTranscriptsRoot)
  if (targetProjects.status === 'rejected') {
    return { ok: false, reason: 'target-dir-unresolved' }
  }
  if (sourceProject.status === 'absent') {
    return { ok: false, reason: 'source-not-found' }
  }
  // Why: both universes link `projects/` to the same store, so the target already reads
  // this transcript — and every path below would resolve onto the source file itself,
  // truncating the user's conversation with copyFileSync. Nothing to do is the success.
  if (
    targetProjects.status === 'resolved' &&
    isSamePath(targetProjects.canonicalRoot, sourceProject.canonicalProjectsRoot)
  ) {
    return { ok: true, sessionId: args.sessionId, copiedFileCount: 0 }
  }
  try {
    const targetProjectsRoot =
      targetProjects.status === 'resolved' ? targetProjects.canonicalRoot : targetProjects.path
    const targetProjectDir = join(targetProjectsRoot, sourceProject.dirName)
    mkdirSync(targetProjectDir, { recursive: true })
    let copiedFileCount = 0
    for (const entry of readdirSync(sourceProject.dirPath)) {
      if (!entry.startsWith(args.sessionId) || isParkedTranscriptDuplicate(entry)) {
        continue
      }
      const sourceFile = join(sourceProject.dirPath, entry)
      // Why: never follow symlinks — a planted link could exfiltrate arbitrary files across universes.
      if (
        !isRealFile(sourceFile) ||
        !isInsideRoot(sourceProject.canonicalProjectsRoot, sourceFile)
      ) {
        continue
      }
      const targetFile = join(targetProjectDir, entry)
      copyFileSync(sourceFile, targetFile)
      chmodSync(targetFile, 0o600)
      copiedFileCount += 1
    }
    if (copiedFileCount === 0) {
      return { ok: false, reason: 'source-not-found' }
    }
    return { ok: true, sessionId: args.sessionId, copiedFileCount }
  } catch {
    return { ok: false, reason: 'copy-failed' }
  }
}

import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync
} from 'node:fs'
import { join, sep } from 'node:path'
import type { ClaudeManagedAccount, ClaudeSessionFailoverCopyResult } from '../../shared/types'
import { resolveOwnedClaudeManagedAuthPath } from './managed-auth-path'

// Why: the session id becomes a filename prefix; anything outside this shape could traverse or hide files.
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,511}$/

export type CopyClaudeSessionForFailoverArgs = {
  sessionId: string
  cwd: string
  targetAccountId: string
  /** Managed account whose universe hosted the limited session; null/undefined = shared ~/.claude. */
  sourceAccountId?: string | null
}

export type ClaudeSessionFailoverDeps = {
  getAccounts(): readonly ClaudeManagedAccount[]
  /** Shared Claude config dir (~/.claude or CLAUDE_CONFIG_DIR) used when the source session is unpinned. */
  getSharedConfigDir(): string
}

/** Mirrors Claude Code's projects/<encoded-cwd> directory naming. */
export function encodeClaudeProjectDirName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

function isRealDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory()
  } catch {
    return false
  }
}

function isRealFile(path: string): boolean {
  try {
    return lstatSync(path).isFile()
  } catch {
    return false
  }
}

/** Canonical root only when it exists, is not a symlink, and is a directory. */
function resolveRealRoot(path: string): string | null {
  try {
    if (!existsSync(path) || lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory()) {
      return null
    }
    return realpathSync(path)
  } catch {
    return null
  }
}

function isInsideRoot(canonicalRoot: string, path: string): boolean {
  try {
    return realpathSync(path).startsWith(canonicalRoot + sep)
  } catch {
    return false
  }
}

function resolveManagedSourceRoot(
  account: ClaudeManagedAccount | undefined
):
  | { ok: true; root: string }
  | { ok: false; reason: 'source-account-not-found' | 'source-dir-unresolved' } {
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

/** Finds the source project dir holding `<sessionId>.jsonl`: encoded-cwd dir first, then a bounded scan. */
function findSourceProjectDir(
  canonicalSourceRoot: string,
  cwd: string,
  sessionId: string
): { dirName: string; dirPath: string } | null {
  const projectsDir = join(canonicalSourceRoot, 'projects')
  if (!isRealDirectory(projectsDir)) {
    return null
  }
  const containsSession = (dirName: string): boolean => {
    const dirPath = join(projectsDir, dirName)
    const sessionFile = join(dirPath, `${sessionId}.jsonl`)
    return (
      isRealDirectory(dirPath) &&
      isRealFile(sessionFile) &&
      isInsideRoot(canonicalSourceRoot, sessionFile)
    )
  }
  const encoded = encodeClaudeProjectDirName(cwd)
  if (encoded && containsSession(encoded)) {
    return { dirName: encoded, dirPath: join(projectsDir, encoded) }
  }
  // Why: encoding drift (e.g. path normalization differences) must not strand a copyable transcript.
  let entries: string[]
  try {
    entries = readdirSync(projectsDir)
  } catch {
    return null
  }
  for (const entry of entries) {
    if (entry !== encoded && containsSession(entry)) {
      return { dirName: entry, dirPath: join(projectsDir, entry) }
    }
  }
  return null
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

  const sourceProject = findSourceProjectDir(sourceRoot, args.cwd, sessionId)
  if (!sourceProject) {
    return { ok: false, reason: 'source-not-found' }
  }

  try {
    const targetProjectDir = join(targetRoot, 'projects', sourceProject.dirName)
    mkdirSync(targetProjectDir, { recursive: true })
    let copiedFileCount = 0
    for (const entry of readdirSync(sourceProject.dirPath)) {
      if (!entry.startsWith(sessionId)) {
        continue
      }
      const sourceFile = join(sourceProject.dirPath, entry)
      // Why: never follow symlinks — a planted link could exfiltrate arbitrary files into the endpoint universe.
      if (!isRealFile(sourceFile) || !isInsideRoot(sourceRoot, sourceFile)) {
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
    return { ok: true, sessionId, copiedFileCount }
  } catch {
    return { ok: false, reason: 'copy-failed' }
  }
}

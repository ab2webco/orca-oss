import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmdirSync,
  statSync,
  symlinkSync
} from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * One transcript store shared by every managed Claude account.
 *
 * Why: Claude Code reads conversations from `<CLAUDE_CONFIG_DIR>/projects/`, and
 * each managed account has its own config dir, so the same project's history was
 * split across accounts — `/resume` only listed the active account's slice and
 * `claude -c` could resume something older than the user's real last session.
 * Credentials stay isolated per account; only transcripts are shared, since they
 * are the user's data and carry no account secrets.
 *
 * Each account's `projects/` becomes a link to this directory. Verified against
 * the real CLI: it reads and appends through the link and leaves it in place.
 */
const SHARED_TRANSCRIPTS_DIR_NAME = 'claude-transcripts'
const PROJECTS_DIR_NAME = 'projects'

export function getSharedClaudeTranscriptsRoot(): string {
  return join(app.getPath('userData'), SHARED_TRANSCRIPTS_DIR_NAME, PROJECTS_DIR_NAME)
}

/** Windows reserves symlink creation for elevated/Developer-Mode processes; a
 *  directory junction has the same read/write semantics without that privilege. */
function linkDirectory(target: string, linkPath: string): void {
  symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
}

type LinkOutcome = 'already-linked' | 'linked' | 'migrated-and-linked' | 'skipped'

/**
 * Point one account's `projects/` at the shared store, moving any transcripts it
 * already owns into the store first. Idempotent and best-effort: a failure leaves
 * the account's own directory untouched so its history stays readable.
 */
export function linkAccountTranscriptsToSharedStore(managedAuthPath: string): LinkOutcome {
  const sharedRoot = getSharedClaudeTranscriptsRoot()
  const accountProjectsPath = join(managedAuthPath, PROJECTS_DIR_NAME)
  try {
    mkdirSync(sharedRoot, { recursive: true, mode: 0o700 })
    if (existsSync(accountProjectsPath)) {
      // Why: lstat, not stat — an existing link must read as already-linked
      // instead of being migrated into itself.
      if (lstatSync(accountProjectsPath).isSymbolicLink()) {
        return 'already-linked'
      }
      const moved = mergeProjectsIntoSharedStore(accountProjectsPath, sharedRoot)
      // Why: only a directory emptied of every project can be replaced by the
      // link; leftovers mean something was not migrated and must stay reachable.
      if (readdirSync(accountProjectsPath).length > 0) {
        return 'skipped'
      }
      rmdirSync(accountProjectsPath)
      linkDirectory(sharedRoot, accountProjectsPath)
      return moved > 0 ? 'migrated-and-linked' : 'linked'
    }
    linkDirectory(sharedRoot, accountProjectsPath)
    return 'linked'
  } catch (error) {
    console.warn(
      `[claude-transcripts] Could not share transcripts for ${managedAuthPath}:`,
      error instanceof Error ? error.message : error
    )
    return 'skipped'
  }
}

/** Moves each project directory's sessions into the shared store, returning how
 *  many entries moved. Never overwrites a session already in the store. */
function mergeProjectsIntoSharedStore(accountProjectsPath: string, sharedRoot: string): number {
  let moved = 0
  for (const projectSlug of readdirSync(accountProjectsPath)) {
    const sourceProject = join(accountProjectsPath, projectSlug)
    const targetProject = join(sharedRoot, projectSlug)
    try {
      if (!statSync(sourceProject).isDirectory()) {
        continue
      }
      mkdirSync(targetProject, { recursive: true, mode: 0o700 })
      for (const entry of readdirSync(sourceProject)) {
        if (moveSessionEntry(join(sourceProject, entry), join(targetProject, entry))) {
          moved += 1
        }
      }
      // Why: an emptied project dir must go, or it keeps the parent non-empty and
      // blocks replacing it with the link. Anything left behind stays readable.
      if (readdirSync(sourceProject).length === 0) {
        rmdirSync(sourceProject)
      }
    } catch (error) {
      console.warn(`[claude-transcripts] Skipped ${sourceProject}:`, error)
    }
  }
  return moved
}

/**
 * Move one session file/directory into the shared store, resolving a sessionId
 * that exists in two accounts.
 *
 * Why the larger file wins: a failover copies a transcript across universes, so
 * both sides hold the same id and the longer .jsonl is the one that kept
 * transcribing — mtime alone would prefer a stub the losing side touched later.
 *
 * Why the loser is still consumed (renamed aside, not left in place): a leftover
 * keeps the account's projects/ non-empty, which would abort the link and leave
 * that account permanently blind to the shared history — the very bug being
 * fixed. The superseded copy is kept next to the winner rather than deleted, so
 * nothing is destroyed on a wrong guess.
 */
function moveSessionEntry(sourcePath: string, targetPath: string): boolean {
  if (!existsSync(targetPath)) {
    renameSync(sourcePath, targetPath)
    return true
  }
  try {
    const source = statSync(sourcePath)
    const target = statSync(targetPath)
    if (source.isFile() && target.isFile()) {
      if (source.size > target.size) {
        // Park the stored stub beside the winner, then promote the longer copy.
        renameSync(targetPath, supersededPath(targetPath))
        renameSync(sourcePath, targetPath)
        return true
      }
      // The stored copy already wins; park this one in the shared store too.
      renameSync(sourcePath, supersededPath(targetPath))
      return true
    }
  } catch (error) {
    console.warn(`[claude-transcripts] Could not merge ${sourcePath}:`, error)
    return false
  }
  return false
}

/** Sidecar name for a superseded duplicate, next to the winning transcript. Kept
 *  for recovery and ignored by the CLI because it no longer ends in `.jsonl`. */
function supersededPath(winnerPath: string): string {
  const base = winnerPath.replace(/\.jsonl$/, '')
  let candidate = `${base}.superseded`
  for (let attempt = 2; existsSync(candidate); attempt += 1) {
    candidate = `${base}.superseded-${attempt}`
  }
  return candidate
}

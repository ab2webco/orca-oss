import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  symlinkSync,
  type Stats
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { app } from 'electron'

/**
 * One transcript store shared by every Claude universe Orca launches — each
 * managed account's vault and the shared home.
 *
 * Why: Claude Code reads conversations from `<CLAUDE_CONFIG_DIR>/projects/`, and
 * each managed account has its own config dir, so the same project's history was
 * split across accounts — `/resume` only listed the active account's slice and
 * `claude -c` could resume something older than the user's real last session.
 * Credentials stay isolated per account; only transcripts are shared, since they
 * are the user's data and carry no account secrets.
 *
 * Each universe's `projects/` becomes a link to this directory. Verified against
 * the real CLI: it reads and appends through the link and leaves it in place.
 */
const SHARED_TRANSCRIPTS_DIR_NAME = 'claude-transcripts'
const PROJECTS_DIR_NAME = 'projects'
const TRANSCRIPT_EXTENSION = '.jsonl'
/** Claude Code's per-project session cache. Rebuildable — a project with no index
 *  still lists in `/resume`, and stored entries can outlive their `.jsonl`. */
const SESSIONS_INDEX_FILE_NAME = 'sessions-index.json'
/** Ceiling for the redundancy read below. Migration runs on the Electron main
 *  thread during a launch, and a real `~/.claude` holds transcripts of 100 MB+. */
const MAX_REDUNDANCY_CHECK_BYTES = 8 * 1024 * 1024

export function getSharedClaudeTranscriptsRoot(): string {
  return join(app.getPath('userData'), SHARED_TRANSCRIPTS_DIR_NAME, PROJECTS_DIR_NAME)
}

/** Windows reserves symlink creation for elevated/Developer-Mode processes; a
 *  directory junction has the same read/write semantics without that privilege. */
function linkDirectory(target: string, linkPath: string): void {
  symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
}

/** Windows resolves the same directory under either drive-letter case, so a
 *  literal comparison would read Orca's own junction as somebody else's link. */
function isSamePath(left: string, right: string): boolean {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

type LinkOutcome = 'already-linked' | 'linked' | 'migrated-and-linked' | 'skipped'

/**
 * Point one Claude config dir's `projects/` at the shared store, moving any
 * transcripts it already owns into the store first. Idempotent and best-effort:
 * a failure leaves the directory untouched so its history stays readable.
 *
 * Migration is meant to run once per universe — after the link is in place every
 * later call short-circuits on `already-linked`, so nothing re-merges behind a
 * live CLI. Callers must still defer while that universe has a live Claude PTY,
 * whose transcript is mid-append.
 */
export function linkClaudeTranscriptsToSharedStore(claudeConfigDir: string): LinkOutcome {
  const sharedRoot = getSharedClaudeTranscriptsRoot()
  const projectsPath = join(claudeConfigDir, PROJECTS_DIR_NAME)
  try {
    mkdirSync(sharedRoot, { recursive: true, mode: 0o700 })
    // Why realpath, like the symlink branch below: a config dir that reaches the
    // store by any other spelling would otherwise be merged into itself.
    if (
      existsSync(projectsPath) &&
      isSamePath(realpathSync(projectsPath), realpathSync(sharedRoot))
    ) {
      return 'already-linked'
    }
    if (existsSync(projectsPath)) {
      // A link the user pointed somewhere else is theirs; never repoint it.
      if (lstatSync(projectsPath).isSymbolicLink()) {
        return 'skipped'
      }
      const moved = mergeIntoSharedStore(projectsPath, sharedRoot)
      // Why: only a directory emptied of every project can be replaced by the
      // link; leftovers mean something was not migrated and must stay reachable.
      if (readdirSync(projectsPath).length > 0) {
        return 'skipped'
      }
      rmdirSync(projectsPath)
      linkDirectory(sharedRoot, projectsPath)
      return moved > 0 ? 'migrated-and-linked' : 'linked'
    }
    mkdirSync(claudeConfigDir, { recursive: true, mode: 0o700 })
    linkDirectory(sharedRoot, projectsPath)
    return 'linked'
  } catch (error) {
    console.warn(
      `[claude-transcripts] Could not share transcripts for ${claudeConfigDir}:`,
      error instanceof Error ? error.message : error
    )
    return 'skipped'
  }
}

/** Moves everything under `sourceDir` into `targetDir`, returning how many
 *  entries landed in the store. */
function mergeIntoSharedStore(sourceDir: string, targetDir: string): number {
  let moved = 0
  for (const entry of readdirSync(sourceDir)) {
    if (mergeEntry(join(sourceDir, entry), join(targetDir, entry))) {
      moved += 1
    }
  }
  return moved
}

/**
 * Move one entry into the shared store, resolving a name that exists on both
 * sides.
 *
 * Why directories recurse instead of failing: a project holds session sidechain
 * directories and a `memory/` directory, and every universe grows its own. Left
 * unmerged, one such directory kept the source non-empty, aborted the link, and
 * left that universe permanently blind to the shared history — the very bug
 * being fixed.
 */
function mergeEntry(sourcePath: string, targetPath: string): boolean {
  try {
    if (basename(sourcePath) === SESSIONS_INDEX_FILE_NAME) {
      return parkSessionsIndex(sourcePath, targetPath)
    }
    if (!existsSync(targetPath)) {
      mkdirSync(dirname(targetPath), { recursive: true, mode: 0o700 })
      renameSync(sourcePath, targetPath)
      return true
    }
    // Why lstat: a symlink is moved as a link, never followed — following one
    // would read and write outside the universe being migrated.
    const source = lstatSync(sourcePath)
    const target = lstatSync(targetPath)
    if (source.isSymbolicLink()) {
      parkAside(sourcePath, targetPath, false)
      return true
    }
    // Why the link loses: a real entry outranks it, or the store would serve a
    // link's content as the canonical transcript and park the actual one.
    if (target.isSymbolicLink()) {
      parkAside(targetPath, targetPath, false)
      renameSync(sourcePath, targetPath)
      return true
    }
    if (source.isDirectory() && target.isDirectory()) {
      const moved = mergeIntoSharedStore(sourcePath, targetPath)
      // Why: an emptied directory must go, or it keeps its parent non-empty and
      // blocks replacing it with the link. Anything left behind stays readable.
      if (readdirSync(sourcePath).length === 0) {
        rmdirSync(sourcePath)
      }
      return moved > 0
    }
    if (source.isFile() && target.isFile()) {
      return resolveFileCollision(sourcePath, targetPath, source, target)
    }
    // A directory facing a file cannot merge; park it so the source can still
    // empty and no bytes are lost.
    parkAside(sourcePath, targetPath, source.isDirectory())
    return true
  } catch (error) {
    console.warn(`[claude-transcripts] Could not merge ${sourcePath}:`, error)
    return false
  }
}

/**
 * Retire both copies of a project's session cache instead of merging them: each
 * one indexes only the universe that wrote it, so promoting either would describe
 * a directory that just gained sessions. Parked rather than deleted, and the CLI
 * rebuilds the index from the merged directory.
 */
function parkSessionsIndex(sourcePath: string, targetPath: string): boolean {
  if (existsSync(targetPath)) {
    parkAside(targetPath, targetPath, false)
  }
  mkdirSync(dirname(targetPath), { recursive: true, mode: 0o700 })
  parkAside(sourcePath, targetPath, false)
  return true
}

/**
 * Move `fromPath` to a sidecar beside `winnerPath`, keeping it for recovery.
 *
 * A file claims its name exclusively so a concurrent migration cannot pick the
 * same one, and the claim is released if the move fails — an orphaned placeholder
 * would burn the name and be served to nobody. A directory cannot be renamed onto
 * that placeholder, so it settles for a free name.
 */
function parkAside(fromPath: string, winnerPath: string, fromIsDirectory: boolean): void {
  if (fromIsDirectory) {
    renameSync(fromPath, unusedSupersededPath(winnerPath))
    return
  }
  const parked = supersededPath(winnerPath)
  try {
    renameSync(fromPath, parked)
  } catch (error) {
    rmSync(parked, { force: true })
    throw error
  }
}

/**
 * Decide which of two same-named files the store keeps.
 *
 * Transcripts are append-only, so the longer `.jsonl` is the one that kept
 * transcribing — a failover copies a transcript across universes, so both sides
 * hold the same id and mtime alone would prefer a stub the losing side touched
 * later. Everything else in a project (`memory/` notes) is hand-edited and can
 * shrink, so those go by mtime.
 *
 * The loser is parked next to the winner rather than deleted, so nothing is
 * destroyed on a wrong guess — unless it is a strict prefix of the winner, which
 * proves every one of its bytes already survived.
 */
function resolveFileCollision(
  sourcePath: string,
  targetPath: string,
  source: Stats,
  target: Stats
): boolean {
  const isTranscript = targetPath.endsWith(TRANSCRIPT_EXTENSION)
  const sourceWins = isTranscript ? source.size > target.size : source.mtimeMs > target.mtimeMs
  const [winner, loser] = sourceWins ? [sourcePath, targetPath] : [targetPath, sourcePath]
  const redundantLoser =
    isTranscript && isPrefixOf(loser, winner, sourceWins ? target.size : source.size)
  if (winner === targetPath) {
    if (redundantLoser) {
      rmSync(sourcePath)
      return true
    }
    parkAside(sourcePath, targetPath, false)
    return true
  }
  if (redundantLoser) {
    rmSync(targetPath)
  } else {
    parkAside(targetPath, targetPath, false)
  }
  renameSync(sourcePath, targetPath)
  return true
}

/**
 * True when `candidate` is byte-identical to the start of `whole`, so keeping
 * `whole` keeps all of it. Reads only `candidate`'s length from `whole`.
 *
 * `expectedSize` is re-checked afterwards: a Claude run outside Orca appears in
 * no live-PTY registry, and bytes it appended mid-read must not be dropped.
 */
function isPrefixOf(candidate: string, whole: string, expectedSize: number): boolean {
  let handle: number | null = null
  try {
    if (expectedSize > MAX_REDUNDANCY_CHECK_BYTES) {
      return false
    }
    const expected = readFileSync(candidate)
    if (expected.length !== expectedSize) {
      return false
    }
    if (expected.length === 0) {
      return true
    }
    const head = Buffer.alloc(expected.length)
    handle = openSync(whole, 'r')
    const matches =
      readSync(handle, head, 0, expected.length, 0) === expected.length && head.equals(expected)
    return matches && statSync(candidate).size === expectedSize
  } catch {
    return false
  } finally {
    if (handle !== null) {
      closeSync(handle)
    }
  }
}

/**
 * Claim a sidecar name for a superseded duplicate, next to the winning
 * transcript. Kept for recovery and ignored by the CLI because it no longer ends
 * in `.jsonl`.
 *
 * The name is claimed by creating it exclusively rather than by testing
 * existence: two universes migrating into the same project concurrently would
 * otherwise pick the same name and one rename would erase the other's sidecar.
 */
function supersededPath(winnerPath: string): string {
  for (let attempt = 1; ; attempt += 1) {
    const candidate = supersededCandidate(winnerPath, attempt)
    try {
      closeSync(openSync(candidate, 'wx'))
      return candidate
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }
    }
  }
}

/** Same naming, without claiming the name — for a directory, which cannot be
 *  renamed onto the placeholder file an exclusive claim would leave behind. */
function unusedSupersededPath(winnerPath: string): string {
  for (let attempt = 1; ; attempt += 1) {
    const candidate = supersededCandidate(winnerPath, attempt)
    if (!existsSync(candidate)) {
      return candidate
    }
  }
}

function supersededCandidate(winnerPath: string, attempt: number): string {
  const base = winnerPath.replace(/\.jsonl$/, '')
  return attempt === 1 ? `${base}.superseded` : `${base}.superseded-${attempt}`
}

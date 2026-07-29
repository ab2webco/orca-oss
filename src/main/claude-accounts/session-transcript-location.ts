import { existsSync, lstatSync, readdirSync, realpathSync, type Stats } from 'node:fs'
import { join, sep } from 'node:path'

/**
 * Locating a session transcript inside a Claude universe, and deciding which paths
 * a cross-universe copy is allowed to touch.
 *
 * Every guard here refuses to follow a symlink, so a link planted in a universe
 * cannot pull a file out of it. The one exception is a `projects/` link pointing at
 * Orca's own shared transcript store, which ORCA-97 creates in every universe by
 * design — see resolveProjectsDir.
 */

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

export function isRealFile(path: string): boolean {
  try {
    return lstatSync(path).isFile()
  } catch {
    return false
  }
}

/** Canonical root only when it exists, is not a symlink, and is a directory. */
export function resolveRealRoot(path: string): string | null {
  try {
    if (!existsSync(path) || lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory()) {
      return null
    }
    return realpathSync(path)
  } catch {
    return null
  }
}

export function isInsideRoot(canonicalRoot: string, path: string): boolean {
  try {
    return realpathSync(path).startsWith(canonicalRoot + sep)
  } catch {
    return false
  }
}

/** Windows resolves the same directory under either drive-letter case, so a literal
 *  compare would read Orca's own junction as somebody else's link. */
export function isSamePath(left: string, right: string): boolean {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

export type ProjectsDirResolution =
  /** Usable: either the universe's own directory or its link to Orca's store. */
  | { status: 'resolved'; path: string; canonicalRoot: string }
  /** Nothing there yet — a copy target may still create it. */
  | { status: 'absent'; path: string }
  /** A link Orca does not own, or not a directory at all. */
  | { status: 'rejected' }

/**
 * Resolves a universe's `projects/` directory.
 *
 * Why a link is accepted at all: ORCA-97 points every universe's `projects/` at one
 * Orca-owned store, so demanding a physical directory here rejected every linked
 * vault — which is every vault on a machine that ran the migration. Only that store
 * qualifies: a link pointing anywhere else is still refused, and the per-file
 * containment check still runs against whatever root this returns, so a transcript
 * symlink planted inside the store cannot smuggle a file out of it.
 */
export function resolveProjectsDir(
  configRoot: string,
  sharedTranscriptsRoot: string
): ProjectsDirResolution {
  const path = join(configRoot, 'projects')
  let entry: Stats
  try {
    entry = lstatSync(path)
  } catch {
    return { status: 'absent', path }
  }
  // Why symlink first: a Windows junction reports as a link, and only the store may be linked.
  if (entry.isSymbolicLink()) {
    try {
      const canonicalRoot = realpathSync(path)
      return isSamePath(canonicalRoot, realpathSync(sharedTranscriptsRoot))
        ? { status: 'resolved', path, canonicalRoot }
        : { status: 'rejected' }
    } catch {
      return { status: 'rejected' }
    }
  }
  if (!entry.isDirectory()) {
    return { status: 'rejected' }
  }
  try {
    return { status: 'resolved', path, canonicalRoot: realpathSync(path) }
  } catch {
    return { status: 'rejected' }
  }
}

/** Finds the project dir holding `<sessionId>.jsonl`: encoded-cwd dir first, then a bounded scan. */
export function findSessionProjectDir(
  canonicalProjectsRoot: string,
  cwd: string,
  sessionId: string
): { dirName: string; dirPath: string } | null {
  const containsSession = (dirName: string): boolean => {
    const dirPath = join(canonicalProjectsRoot, dirName)
    const sessionFile = join(dirPath, `${sessionId}.jsonl`)
    return (
      isRealDirectory(dirPath) &&
      isRealFile(sessionFile) &&
      isInsideRoot(canonicalProjectsRoot, sessionFile)
    )
  }
  const encoded = encodeClaudeProjectDirName(cwd)
  if (encoded && containsSession(encoded)) {
    return { dirName: encoded, dirPath: join(canonicalProjectsRoot, encoded) }
  }
  // Why: encoding drift (e.g. path normalization differences) must not strand a copyable transcript.
  let entries: string[]
  try {
    entries = readdirSync(canonicalProjectsRoot)
  } catch {
    return null
  }
  for (const entry of entries) {
    if (entry !== encoded && containsSession(entry)) {
      return { dirName: entry, dirPath: join(canonicalProjectsRoot, entry) }
    }
  }
  return null
}

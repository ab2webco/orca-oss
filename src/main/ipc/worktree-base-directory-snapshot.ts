import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { normalizeRuntimePathForComparison } from '../../shared/cross-platform-path'
import type { WorktreeBaseRepoWatchConfig } from './worktree-base-directory-event-filter'
import type { WorktreeBasePollEvent } from './worktree-base-directory-poller'

function statSignature(s: { mtimeMs: number; ctimeMs: number; ino: number }): string {
  return `${s.mtimeMs}:${s.ctimeMs}:${s.ino}`
}

export async function dirSignature(path: string): Promise<string> {
  try {
    return statSignature(await stat(path))
  } catch {
    return 'missing'
  }
}

export async function hasGitMarker(dir: string): Promise<boolean> {
  try {
    await stat(join(dir, '.git'))
    return true
  } catch {
    return false
  }
}

export type BaseSnapshot = {
  // worktree-candidate dir → whether its `.git` completion marker exists
  markers: Map<string, boolean>
  // dirs whose listing determines the candidate set: the root plus any
  // nested repo containers. Their stat signatures gate the next full scan.
  gateDirs: string[]
  // index-aligned with gateDirs, each sampled *before* that dir's listing
  gateSignatures: string[]
}

// Depth-1 worktree dirs (flat layout), plus depth-2 dirs under each nested
// repo's container, mirroring what worktree-base-directory-event-filter
// matches: `<wt>/.git` completion markers and `<wt>` deletions.
export async function snapshotBase(
  rootPath: string,
  repos: ReadonlyMap<string, WorktreeBaseRepoWatchConfig>
): Promise<BaseSnapshot> {
  const markers = new Map<string, boolean>()
  const gateDirs = [rootPath]
  // Why: sampling the signature before the listing makes a write that races the
  // scan look stale next tick (one redundant rescan) instead of invisible until
  // the backstop, which is up to 15 ticks of missed creates/deletes.
  const gateSignatures = [await dirSignature(rootPath)]
  const configs = [...repos.values()]
  const includeFlat = configs.some((config) => !config.nestWorkspaces)
  const nestedRepoNames = new Set(
    configs
      .filter((config) => config.nestWorkspaces)
      .map((config) => normalizeRuntimePathForComparison(config.repoName))
  )

  let rootEntries
  try {
    rootEntries = await readdir(rootPath, { withFileTypes: true })
  } catch {
    // Root vanished: an empty snapshot diffs into delete events for every
    // previously-known worktree dir, matching the old watcher's error path.
    return { markers, gateDirs, gateSignatures }
  }

  const candidates: string[] = []
  for (const entry of rootEntries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      continue
    }
    const entryPath = join(rootPath, entry.name)
    if (includeFlat) {
      candidates.push(entryPath)
    }
    if (nestedRepoNames.has(normalizeRuntimePathForComparison(entry.name))) {
      gateDirs.push(entryPath)
      gateSignatures.push(await dirSignature(entryPath))
      let subEntries
      try {
        subEntries = await readdir(entryPath, { withFileTypes: true })
      } catch {
        subEntries = []
      }
      for (const sub of subEntries) {
        if (sub.isDirectory() || sub.isSymbolicLink()) {
          candidates.push(join(entryPath, sub.name))
        }
      }
    }
  }

  for (const dir of candidates) {
    markers.set(dir, await hasGitMarker(dir))
  }
  return { markers, gateDirs, gateSignatures }
}

export function diffBase(prev: BaseSnapshot, next: BaseSnapshot): WorktreeBasePollEvent[] {
  const events: WorktreeBasePollEvent[] = []
  for (const [dir, marker] of next.markers) {
    if (marker && prev.markers.get(dir) !== true) {
      events.push({ type: 'create', path: join(dir, '.git') })
    }
  }
  for (const dir of prev.markers.keys()) {
    if (!next.markers.has(dir)) {
      events.push({ type: 'delete', path: dir })
    }
  }
  return events
}

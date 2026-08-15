import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { normalizeAgentSessionsDir } from './session-scanner-values'

// The default local roots for the two agents whose subagent transcripts are
// read back by renderer-supplied path (Claude and OMP). Discovery scans these;
// the IPC listers use the root enumerations below to reject arbitrary paths.
const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects')
export const OMP_SESSIONS_DIR = normalizeAgentSessionsDir(
  process.env.OMP_CODING_AGENT_DIR?.trim() || join(homedir(), '.omp', 'agent', 'sessions'),
  '.omp'
)

// The local host and each WSL distro's `~/.claude/projects`. Callers reading
// Claude session files by path use these roots to reject arbitrary paths.
export function claudeProjectsRootDirs(args: {
  claudeProjectsDir?: string
  /** The lab's managed account vaults each own a projects root outside ~/.claude. */
  additionalClaudeProjectsDirs?: readonly string[]
  wslHomeDirs?: readonly string[]
}): string[] {
  // Why deduped by realpath: once a managed vault's projects/ is a link to the
  // shared transcript store, several roots resolve to one directory and every
  // session would be listed once per account.
  return uniqueExistingRoots([
    args.claudeProjectsDir ?? CLAUDE_PROJECTS_DIR,
    ...(args.additionalClaudeProjectsDirs ?? []),
    ...(args.wslHomeDirs ?? []).map((homeDir) => join(homeDir, '.claude', 'projects'))
  ])
}

/** Collapses roots that resolve to the same directory, keeping first-seen order
 *  and passing through paths that do not exist yet. */
function uniqueExistingRoots(rootDirs: readonly string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const rootDir of rootDirs) {
    let key = rootDir
    try {
      key = realpathSync(rootDir)
    } catch {
      key = rootDir
    }
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    unique.push(rootDir)
  }
  return unique
}

// The local host and each WSL distro's OMP sessions root. Callers reading OMP
// session files by path use these roots to reject arbitrary paths.
export function ompSessionsRootDirs(args: {
  ompSessionsDir?: string
  wslHomeDirs?: readonly string[]
}): string[] {
  return (
    sessionRootDirs(
      args.ompSessionsDir ?? OMP_SESSIONS_DIR,
      normalizedWslHomeDirs(args.wslHomeDirs),
      ['.omp', 'agent', 'sessions']
    )
      // Why: OMP_CODING_AGENT_DIR='/' normalizes to '', which resolve()s to the
      // process cwd — an empty root would silently allowlist it.
      .filter((rootDir) => rootDir.trim().length > 0)
  )
}

export function normalizedWslHomeDirs(homeDirs: readonly string[] | undefined): string[] {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const homeDir of homeDirs ?? []) {
    const trimmed = homeDir.trim()
    if (!trimmed || seen.has(trimmed)) {
      continue
    }
    seen.add(trimmed)
    unique.push(trimmed)
  }
  return unique
}

export function sessionRootDirs(
  hostRootDir: string,
  wslHomeDirs: readonly string[],
  segments: readonly string[]
): string[] {
  return [hostRootDir, ...wslHomeDirs.map((homeDir) => join(homeDir, ...segments))]
}

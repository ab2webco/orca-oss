import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects')

export function claudeProjectsRootDirs(args: {
  claudeProjectsDir?: string
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

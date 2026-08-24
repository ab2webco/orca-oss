import { realpathSync } from 'node:fs'

export function uniqueExistingClaudeProjectRoots(rootDirs: readonly string[]): string[] {
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

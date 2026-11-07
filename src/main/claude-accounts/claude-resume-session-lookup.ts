import { readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

/** A Claude config dir Orca can launch: the shared home (`accountId: null`) or a managed vault. */
export type ClaudeResumeUniverse = { accountId: string | null; configDir: string }

export type ClaudeSessionLookupResult =
  | { kind: 'found'; accountId: string | null }
  | { kind: 'missing' }
  | { kind: 'ambiguous'; accountIds: (string | null)[] }

export type ClaudeSessionLookupFs = {
  realpath(target: string): Promise<string>
  readdir(dir: string): Promise<string[]>
  isFile(file: string): Promise<boolean>
}

const nodeFs: ClaudeSessionLookupFs = {
  realpath: (target) => realpath(target),
  readdir: (dir) => readdir(dir),
  isFile: async (file) => (await stat(file)).isFile()
}

// Why: the id becomes a file name; anything else could name a path outside `projects/`.
const SAFE_SESSION_ID = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/

/**
 * Which universe holds a Claude conversation, by `projects/<slug>/<id>.jsonl`. Universes whose
 * `projects/` resolves to one directory (the shared transcript store) are scanned once, and a hit
 * there counts for all of them: that file names no single account.
 */
export async function findClaudeSessionUniverse(args: {
  sessionId: string
  universes: readonly ClaudeResumeUniverse[]
  fs?: ClaudeSessionLookupFs
  pathApi?: Pick<typeof path, 'join'>
  caseInsensitivePaths?: boolean
}): Promise<ClaudeSessionLookupResult> {
  if (!SAFE_SESSION_ID.test(args.sessionId)) {
    return { kind: 'missing' }
  }
  const fs = args.fs ?? nodeFs
  const join = (args.pathApi ?? path).join
  const fileName = `${args.sessionId}.jsonl`
  const groups = new Map<string, { dir: string; accountIds: Set<string | null> }>()
  await Promise.all(
    args.universes.map(async ({ accountId, configDir }) => {
      const dir = await fs.realpath(join(configDir, 'projects')).catch(() => null)
      if (dir === null) {
        return
      }
      const key = args.caseInsensitivePaths ? dir.toLowerCase() : dir
      const group = groups.get(key) ?? { dir, accountIds: new Set() }
      group.accountIds.add(accountId)
      groups.set(key, group)
    })
  )
  const holders = new Set<string | null>()
  await Promise.all(
    [...groups.values()].map(async ({ dir, accountIds }) => {
      const slugs = await fs.readdir(dir).catch(() => [] as string[])
      const hits = await Promise.all(
        slugs.map((slug) => fs.isFile(join(dir, slug, fileName)).catch(() => false))
      )
      if (hits.some(Boolean)) {
        accountIds.forEach((accountId) => holders.add(accountId))
      }
    })
  )
  // Why universe order: the message lists candidates the way the caller named them.
  const accountIds = [...new Set(args.universes.map((one) => one.accountId))].filter((id) =>
    holders.has(id)
  )
  if (accountIds.length === 0) {
    return { kind: 'missing' }
  }
  return accountIds.length === 1
    ? { kind: 'found', accountId: accountIds[0]! }
    : { kind: 'ambiguous', accountIds }
}

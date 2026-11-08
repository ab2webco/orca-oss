import { readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import type { AgentProviderSessionMetadata } from '../../shared/agent-session-resume'

/** A Claude config dir Orca can launch: the shared home (`accountId: null`) or a managed vault. */
export type ClaudeResumeUniverse = { accountId: string | null; configDir: string }

/**
 * Where a resumed conversation can be read. `shared`: any account can, through the shared store or
 * because its recorded file exists. `universe`: only that universe, whose link to the store was
 * skipped. `missing`: no account can.
 */
export type ClaudeResumeSessionLocation =
  | { kind: 'shared' }
  | { kind: 'universe'; accountId: string | null }
  | { kind: 'missing' }

export type ClaudeResumeSessionFs = {
  realpath(target: string): Promise<string>
  readdir(dir: string): Promise<string[]>
  isFile(file: string): Promise<boolean>
}

const nodeFs: ClaudeResumeSessionFs = {
  realpath: (target) => realpath(target),
  readdir: (dir) => readdir(dir),
  isFile: async (file) => (await stat(file)).isFile()
}

// Why: the name becomes a path segment; anything else could reach outside its directory.
const SAFE_TRANSCRIPT_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*\.jsonl$/

function transcriptNamesOf(session: AgentProviderSessionMetadata): string[] {
  // Why both: recent Claude Code can name the transcript file apart from its session id.
  const fromPath = session.transcriptPath?.split(/[\\/]/).findLast(Boolean)
  return [...new Set([fromPath, `${session.id}.jsonl`])].filter(
    (name): name is string => name !== undefined && SAFE_TRANSCRIPT_NAME.test(name)
  )
}

/**
 * Finds where a Claude conversation can be resumed. Every linked universe's `projects/` resolves to
 * one shared store, so only universes whose link was skipped (unmigrated leftovers, a failed link)
 * are scanned, and only when neither the recorded file nor the store answers: a linked machine pays
 * nothing extra.
 */
export async function locateClaudeResumeSession(args: {
  storeRoot: string
  universes: readonly ClaudeResumeUniverse[]
  session: AgentProviderSessionMetadata
  fs?: ClaudeResumeSessionFs
  pathApi?: Pick<typeof path, 'join' | 'sep'>
  caseInsensitivePaths?: boolean
}): Promise<ClaudeResumeSessionLocation> {
  const fs = args.fs ?? nodeFs
  const { join, sep } = args.pathApi ?? path
  const comparable = (value: string): string =>
    args.caseInsensitivePaths ? value.toLowerCase() : value
  const isWithin = (child: string, dir: string): boolean =>
    comparable(child).startsWith(comparable(dir.endsWith(sep) ? dir : dir + sep))
  const realOf = (target: string): Promise<string | null> => fs.realpath(target).catch(() => null)
  const names = transcriptNamesOf(args.session)
  const holds = async (dir: string): Promise<boolean> => {
    if (names.length === 0) {
      return false
    }
    const projects = await fs.readdir(dir).catch(() => [] as string[])
    const hits = await Promise.all(
      projects.flatMap((project) =>
        names.map((name) => fs.isFile(join(dir, project, name)).catch(() => false))
      )
    )
    return hits.some(Boolean)
  }

  const store = await realOf(args.storeRoot)
  const unlinked = async (): Promise<{ accountId: string | null; dir: string }[]> => {
    const resolved = await Promise.all(
      args.universes.map(async ({ accountId, configDir }) => ({
        accountId,
        dir: await realOf(join(configDir, 'projects'))
      }))
    )
    return resolved.filter(
      (one): one is { accountId: string | null; dir: string } =>
        one.dir !== null && (store === null || comparable(one.dir) !== comparable(store))
    )
  }

  // Why first: a recorded file that exists is proof on its own.
  const recorded = args.session.transcriptPath ? await realOf(args.session.transcriptPath) : null
  if (recorded !== null && (await fs.isFile(recorded).catch(() => false))) {
    if (store !== null && isWithin(recorded, store)) {
      return { kind: 'shared' }
    }
    const owner = (await unlinked()).find(({ dir }) => isWithin(recorded, dir))
    return owner ? { kind: 'universe', accountId: owner.accountId } : { kind: 'shared' }
  }
  if (store !== null && (await holds(store))) {
    return { kind: 'shared' }
  }
  for (const { accountId, dir } of await unlinked()) {
    // Why the first holder: no other account can read a conversation outside the store.
    if (await holds(dir)) {
      return { kind: 'universe', accountId }
    }
  }
  return { kind: 'missing' }
}

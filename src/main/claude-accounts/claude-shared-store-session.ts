import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { AgentProviderSessionMetadata } from '../../shared/agent-session-resume'

/** `no-store`: this host keeps no shared transcript store, so its absence proves nothing. */
export type SharedStoreSessionVerdict = 'found' | 'missing' | 'no-store'

export type SharedStoreFs = {
  readdir(dir: string): Promise<string[]>
  isFile(file: string): Promise<boolean>
}

const nodeFs: SharedStoreFs = {
  readdir: (dir) => readdir(dir),
  isFile: async (file) => (await stat(file)).isFile()
}

// Why: the name becomes a path segment; anything else could reach outside the store.
const SAFE_TRANSCRIPT_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*\.jsonl$/

function transcriptNamesOf(session: AgentProviderSessionMetadata): string[] {
  // Why both: recent Claude Code can name the transcript file apart from its session id.
  const fromPath = session.transcriptPath?.split(/[\\/]/).findLast(Boolean)
  return [...new Set([fromPath, `${session.id}.jsonl`])].filter(
    (name): name is string => name !== undefined && SAFE_TRANSCRIPT_NAME.test(name)
  )
}

/**
 * Whether the shared transcript store holds a conversation. Every universe Orca launches links its
 * `projects/` here, so a conversation in the store resumes on any account, and one missing from it
 * resumes on none.
 */
export async function findSessionInSharedStore(args: {
  storeRoot: string
  session: AgentProviderSessionMetadata
  fs?: SharedStoreFs
  pathApi?: Pick<typeof path, 'join'>
}): Promise<SharedStoreSessionVerdict> {
  const fs = args.fs ?? nodeFs
  const join = (args.pathApi ?? path).join
  const names = transcriptNamesOf(args.session)
  let projects: string[]
  try {
    projects = await fs.readdir(args.storeRoot)
  } catch {
    return 'no-store'
  }
  if (names.length === 0) {
    return 'missing'
  }
  const hits = await Promise.all(
    projects.flatMap((project) =>
      names.map((name) => fs.isFile(join(args.storeRoot, project, name)).catch(() => false))
    )
  )
  return hits.some(Boolean) ? 'found' : 'missing'
}

import type { GameAgent } from './orchestrator-game-state'

/** A session found on a paired host (ORCA-914): its pane there, never a dispatch of this home. */
export type FoundHostPane = {
  /** Its row's key here, `remote-found:<environment>:<host pane>`. */
  paneKey: string
  /** Its pane key on the host. */
  hostPane: string
  environmentId: string
  host: string
  worktreeId: string
}

const FOUND_PREFIX = 'remote-found:'

// Why the leaf: one pane keeps its leaf id while its tab key form differs between readers.
export const samePane = (a: string, b: string): boolean =>
  a === b || (a.includes(':') && a.slice(a.indexOf(':')) === b.slice(b.indexOf(':')))

/** Where a found session runs on its paired host, or null for any other row. */
export function foundHostPaneOf(
  agent: Pick<GameAgent, 'paneKey' | 'remote' | 'worktree'>
): FoundHostPane | null {
  const environmentId = agent.remote?.environmentId
  const prefix = `${FOUND_PREFIX}${environmentId}:`
  if (!environmentId || !agent.worktree || !agent.paneKey.startsWith(prefix)) {
    return null
  }
  return {
    paneKey: agent.paneKey,
    hostPane: agent.paneKey.slice(prefix.length),
    environmentId,
    host: agent.remote?.host ?? environmentId,
    worktreeId: agent.worktree.id
  }
}

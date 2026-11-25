import { RuntimeClientError } from '../runtime-client'
import { openHostRuntimeClient } from './orchestrator-game-host-client'
import { samePane, type FoundHostPane } from '../../shared/orchestrator-game-found-host-pane'
import type { RuntimeTerminalSummary, RuntimeWorktreePsResult } from '../../shared/runtime-types'

// Why past the default 200: the agent's worktree may sort after the most recent ones.
export const HOST_PS_LIMIT = 10_000
// Why: an agent in these states is in a turn; nothing should land in it or end it unasked.
export const MID_TURN: ReadonlySet<string> = new Set(['working', 'blocked', 'waiting'])

export type FoundHostClose =
  | { outcome: 'closed'; terminal: string }
  | { outcome: 'gone' }
  | { outcome: 'busy'; agentState: string }

/** The found pane's terminal among its host's terminals, asleep or running. */
export const hostTerminalOf = (
  terminals: readonly RuntimeTerminalSummary[],
  hostPane: string
): RuntimeTerminalSummary | undefined =>
  terminals.find((one) => samePane(`${one.tabId}:${one.leafId}`, hostPane))

/** The found pane's agent state as its host reports it now. */
export const hostAgentStateOf = (
  ps: RuntimeWorktreePsResult,
  found: Pick<FoundHostPane, 'worktreeId' | 'hostPane'>
): string | undefined =>
  ps.worktrees
    .find((one) => one.worktreeId === found.worktreeId)
    ?.agents.find((row) => samePane(row.paneKey, found.hostPane))?.state

/**
 * Closes a found session's pane on its paired host, looked up there as `game adopt` does: it has
 * no handle here, and its row key is no dispatch this home knows (ORCA-1396).
 */
export async function closeFoundHostPane(
  found: FoundHostPane,
  options: { keepMidTurn: boolean }
): Promise<FoundHostClose> {
  const where = await openHostRuntimeClient(found.environmentId)
  const [terminals, ps] = await Promise.all([
    where.call<{ terminals: RuntimeTerminalSummary[] }>('terminal.list', {
      worktree: `id:${found.worktreeId}`
    }),
    options.keepMidTurn
      ? where.call<RuntimeWorktreePsResult>('worktree.ps', { limit: HOST_PS_LIMIT })
      : null
  ])
  const terminal = hostTerminalOf(terminals.result.terminals, found.hostPane)
  if (!terminal) {
    return { outcome: 'gone' }
  }
  const agentState = ps ? hostAgentStateOf(ps.result, found) : undefined
  if (agentState && MID_TURN.has(agentState)) {
    return { outcome: 'busy', agentState }
  }
  try {
    await where.call('terminal.close', { terminal: terminal.handle })
  } catch (error) {
    // Why: the runtime has no wire code for this; it arrives as runtime_error carrying the bare message.
    if (error instanceof RuntimeClientError && error.message === 'tab_not_found') {
      return { outcome: 'gone' }
    }
    throw error
  }
  return { outcome: 'closed', terminal: terminal.handle }
}

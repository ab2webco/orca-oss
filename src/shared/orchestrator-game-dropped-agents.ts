import type { GameAgent } from './orchestrator-game-state'

/** An agent the lead dropped from its fleet: hidden, never killed, until `orca game adopt` (ORCA-943). */
export type GameDroppedAgent = {
  worktreeId: string
  /** The paired host it runs on; null on this machine. */
  environmentId: string | null
  name: string
  droppedAt: string
}

const VERSION = 1
// Why a cap: a lead that drops and never adopts must not grow the file without end.
const MAX = 100
const TEXT_MAX = 400

/** Where a dropped agent runs; a restart keeps both, unlike its pane key. */
export type GameDropTarget = Pick<GameDroppedAgent, 'worktreeId' | 'environmentId'>

/** The drop target of an agent with a worktree; null for one without, which is never dropped. */
export const gameDropTargetOf = (
  agent: Pick<GameAgent, 'worktree' | 'remote'>
): GameDropTarget | null =>
  agent.worktree
    ? { worktreeId: agent.worktree.id, environmentId: agent.remote?.environmentId ?? null }
    : null

const keyOf = (target: GameDropTarget): string =>
  `${target.environmentId ?? ''}\0${target.worktreeId}`

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value !== '' && value.length <= TEXT_MAX

function parseEntry(raw: unknown): GameDroppedAgent | null {
  if (typeof raw !== 'object' || raw === null) {
    return null
  }
  const entry = raw as Record<string, unknown>
  const environmentId = entry.environmentId === null ? null : entry.environmentId
  if (
    !isText(entry.worktreeId) ||
    !isText(entry.name) ||
    !isText(entry.droppedAt) ||
    (environmentId !== null && !isText(environmentId))
  ) {
    return null
  }
  return {
    worktreeId: entry.worktreeId,
    environmentId,
    name: entry.name,
    droppedAt: entry.droppedAt
  }
}

/** An unreadable file drops nothing: the worst it does is show the agents again. */
export function parseGameDroppedAgents(text: string): GameDroppedAgent[] {
  try {
    const file = JSON.parse(text) as { dropped?: unknown }
    return Array.isArray(file.dropped)
      ? file.dropped.flatMap((raw) => parseEntry(raw) ?? []).slice(-MAX)
      : []
  } catch {
    return []
  }
}

export const serializeGameDroppedAgents = (dropped: readonly GameDroppedAgent[]): string =>
  `${JSON.stringify({ version: VERSION, dropped }, null, 2)}\n`

export function withDroppedGameAgent(
  dropped: readonly GameDroppedAgent[],
  drop: GameDropTarget & { name: string; at: string }
): GameDroppedAgent[] {
  const { worktreeId, environmentId, name, at } = drop
  return [
    ...withoutDroppedGameAgent(dropped, drop),
    { worktreeId, environmentId, name, droppedAt: at }
  ].slice(-MAX)
}

export const withoutDroppedGameAgent = (
  dropped: readonly GameDroppedAgent[],
  target: GameDropTarget
): GameDroppedAgent[] => dropped.filter((one) => keyOf(one) !== keyOf(target))

/** The lead's fleet without the agents it dropped, and those dropped agents, which adopt can bring back. */
export function splitDroppedGameAgents(
  agents: readonly GameAgent[],
  dropped: readonly GameDroppedAgent[]
): { agents: GameAgent[]; dropped: GameAgent[] } {
  const keys = new Set(dropped.map(keyOf))
  const isDropped = (agent: GameAgent): boolean => {
    const target = gameDropTargetOf(agent)
    return !agent.isLeader && target !== null && keys.has(keyOf(target))
  }
  return {
    agents: agents.filter((agent) => !isDropped(agent)),
    dropped: agents.filter(isDropped)
  }
}

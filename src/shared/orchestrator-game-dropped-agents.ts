import { z } from 'zod'
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

const Text = z.string().min(1).max(TEXT_MAX)
const Entry = z.object({
  worktreeId: Text,
  environmentId: Text.nullable(),
  name: Text,
  droppedAt: Text
})

/** An unreadable file or entry drops nothing: the worst it does is show the agents again. */
export function parseGameDroppedAgents(text: string): GameDroppedAgent[] {
  try {
    const file = JSON.parse(text) as { dropped?: unknown }
    const raw = Array.isArray(file.dropped) ? file.dropped : []
    return raw.flatMap((one) => Entry.safeParse(one).data ?? []).slice(-MAX)
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

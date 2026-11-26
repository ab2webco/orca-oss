import { z } from 'zod'
import type { GameAgent } from './orchestrator-game-state'

/**
 * A member `orca game remove` forgot (ORCA-1476). Kept by its pane key, which no other row
 * carries, so a member that shares its ticket, worktree or folder stays listed.
 */
export type GameForgottenAgent = { paneKey: string; name: string; forgottenAt: string }

// Why a cap: a lead that removes and never restarts its project must not grow the file without end.
const MAX = 200
const Text = z.string().min(1).max(400)
const Entry = z.object({ paneKey: Text, name: Text, forgottenAt: Text })

/** Read from the drops file; an older Orca ignores the field, so the worst it does is list them again. */
export function parseGameForgottenAgents(text: string): GameForgottenAgent[] {
  try {
    const file = JSON.parse(text) as { forgotten?: unknown }
    const raw = Array.isArray(file.forgotten) ? file.forgotten : []
    return raw.flatMap((one) => Entry.safeParse(one).data ?? []).slice(-MAX)
  } catch {
    return []
  }
}

export const withForgottenGameAgent = (
  forgotten: readonly GameForgottenAgent[],
  entry: GameForgottenAgent
): GameForgottenAgent[] =>
  [...forgotten.filter((one) => one.paneKey !== entry.paneKey), entry].slice(-MAX)

/** The lead's fleet without the members it removed; never the lead itself. */
export function withoutForgottenGameAgents(
  agents: readonly GameAgent[],
  forgotten: readonly GameForgottenAgent[]
): GameAgent[] {
  const keys = new Set(forgotten.map((one) => one.paneKey))
  return agents.filter((agent) => agent.isLeader || !keys.has(agent.paneKey))
}

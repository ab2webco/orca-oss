import type { CheckStatus } from './github/pull-request-types'
import { ticketOfMember } from './orchestrator-game-fleet-verbs'
import type { GameAgent, OrchestratorGameState } from './orchestrator-game-state'

/** What tells one member from another in `game state --json`, read as `game fleet` reads it (ORCA-863). */
export type GameMemberIdentity = {
  ticket?: string
  /** The paired host it runs on, or `local`. */
  host: string
  accountEmail?: string
  worktreeId?: string
  branch?: string
  pr?: number
  ci?: CheckStatus | 'none'
}

export type GameStateAgentWithIdentity = GameAgent & Partial<GameMemberIdentity>

function memberIdentityOf(
  agent: GameAgent,
  lead: Pick<OrchestratorGameState, 'worktree' | 'review'>
): GameMemberIdentity {
  const ticket = ticketOfMember(agent)
  // Why: a local member without a worktree of its own runs in the lead's, so its branch and PR are those.
  const inLeadWorktree = !agent.worktree && !agent.remote
  const worktree = agent.worktree ?? (inLeadWorktree ? lead.worktree : null)
  const review = agent.review ?? (inLeadWorktree ? lead.review : null)
  return {
    ...(ticket ? { ticket } : {}),
    host: agent.remote?.host ?? 'local',
    ...(agent.account ? { accountEmail: agent.account.email } : {}),
    ...(worktree ? { worktreeId: worktree.id, branch: worktree.branch } : {}),
    ...(review ? { pr: review.number, ci: review.ci } : {})
  }
}

/** Each member with its identity as flat fields beside the ones the host sent. */
export function withGameMemberIdentity(
  state: OrchestratorGameState
): Omit<OrchestratorGameState, 'agents'> & { agents: GameStateAgentWithIdentity[] } {
  // Why the guard: the mod reads this output too, and must still get the rest from a malformed answer.
  if (!Array.isArray(state.agents)) {
    return state
  }
  return {
    ...state,
    agents: state.agents.map((agent) =>
      agent.isMember && !agent.isLeader ? { ...agent, ...memberIdentityOf(agent, state) } : agent
    )
  }
}

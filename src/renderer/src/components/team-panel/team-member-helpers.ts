import type { AgentSubagentSnapshot } from '../../../../shared/agent-status-types'

export type TeamHelper = { id: string; label: string; state: 'working' | 'done' }

export type TeamHelpers = { running: number; helpers: TeamHelper[] }

/** A member's subagents as the card shows them: helpers inside its session, never members. */
export function teamHelpersOf(
  subagents: readonly AgentSubagentSnapshot[] | undefined
): TeamHelpers {
  const helpers = (subagents ?? []).map(
    (one): TeamHelper => ({
      id: one.id,
      label: one.description ?? one.agentType ?? one.id,
      // Why idle reads done: an idle teammate finished its turn and no longer works for the member.
      state: one.state === 'idle' ? 'done' : 'working'
    })
  )
  return { running: helpers.filter((one) => one.state === 'working').length, helpers }
}

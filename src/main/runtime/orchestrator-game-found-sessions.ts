import type { GameAgent, GameMemberWorktree } from '../../shared/orchestrator-game-state'
import type { GameUnlistedMember } from '../../shared/orchestrator-game-member-sessions'
import type { RuntimeWorktreeAgentRow, RuntimeWorktreePsSummary } from '../../shared/runtime-types'

type FoundSummary = Pick<RuntimeWorktreePsSummary, 'worktreeId' | 'branch' | 'displayName'> & {
  agents: readonly (Pick<RuntimeWorktreeAgentRow, 'paneKey' | 'parentPaneKey'> & {
    restoredUnconfirmed?: boolean
  })[]
}

/**
 * This machine's live sessions no lead lists: every agent, in any worktree or folder workspace,
 * that is not the lead, not a lead itself, and not a live lead's member (ORCA-914).
 */
export function foundGameSessionsOf<S extends FoundSummary>(
  summaries: readonly S[],
  lead: {
    leadPaneKey: string
    hasTerminal: (paneKey: string) => boolean
    /** A pane with a Run of its own leads, even before it launched anyone. */
    isLeadPane: (paneKey: string) => boolean
  }
): { row: S['agents'][number]; worktree: GameMemberWorktree }[] {
  const rows = summaries.flatMap((one) => one.agents)
  const present = new Set(rows.map((row) => row.paneKey))
  const parents = new Set(rows.flatMap((row) => (row.parentPaneKey ? [row.parentPaneKey] : [])))
  return summaries.flatMap((one) =>
    one.agents
      .filter(
        (row) =>
          row.paneKey !== lead.leadPaneKey &&
          // Why: a hydrated row may be a session closed days ago; only a live terminal proves it runs.
          !row.restoredUnconfirmed &&
          lead.hasTerminal(row.paneKey) &&
          !parents.has(row.paneKey) &&
          !lead.isLeadPane(row.paneKey) &&
          (!row.parentPaneKey || !present.has(row.parentPaneKey))
      )
      .map((row) => ({
        row,
        worktree: {
          id: one.worktreeId,
          branch: one.branch.replace(/^refs\/heads\//, ''),
          displayName: one.displayName
        }
      }))
  )
}

/** A found session in the worktree of a member the lead saved is that member, lost from its dispatch (ORCA-735). */
export function recoveredGameMembersOf(
  agents: readonly GameAgent[],
  unlisted: readonly GameUnlistedMember[]
): { agents: GameAgent[]; unlisted: GameUnlistedMember[] } {
  const savedOf = (agent: GameAgent): GameUnlistedMember | undefined =>
    agent.found ? unlisted.find((one) => one.worktreeId === agent.worktree?.id) : undefined
  const recovered = new Set<GameUnlistedMember>()
  return {
    agents: agents.map((agent) => {
      const saved = savedOf(agent)
      if (!saved) {
        return agent
      }
      recovered.add(saved)
      const { found: _found, ...member } = agent
      return { ...member, displayName: saved.name ?? agent.displayName }
    }),
    unlisted: unlisted.filter((one) => !recovered.has(one))
  }
}

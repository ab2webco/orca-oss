import { LOCAL_GAME_HOST, type GameHostProjectLoad } from './orchestrator-game-host-load'
import type { OrchestratorGameState } from './orchestrator-game-state'
import type { RuntimeWorktreePsSummary } from './runtime-types'

/** `worktrees` holds `host\0worktreeId` keys of the lead's own fleet, `paneKeys` its local panes. */
export function otherProjectMembersOf(
  hosts: readonly { host: string; worktrees: readonly RuntimeWorktreePsSummary[] }[],
  own: { paneKeys: ReadonlySet<string>; worktrees: ReadonlySet<string> }
): GameHostProjectLoad[] {
  const counts = new Map<string, GameHostProjectLoad>()
  for (const { host, worktrees } of hosts) {
    for (const one of worktrees) {
      if (own.worktrees.has(`${host}\0${one.worktreeId}`)) {
        continue
      }
      for (const row of one.agents) {
        if (!row.dispatched || row.restoredUnconfirmed || own.paneKeys.has(row.paneKey)) {
          continue
        }
        const key = `${host}\0${one.repo}`
        const load = counts.get(key) ?? { host, repo: one.repo, running: 0 }
        load.running += 1
        counts.set(key, load)
      }
    }
  }
  return [...counts.values()]
}

/** The lead's state with other projects' members on its hosts; `leadWorktreeId` is its own checkout's. */
export function withOtherProjectMembers(
  state: OrchestratorGameState,
  hosts: readonly { host: string; worktrees: readonly RuntimeWorktreePsSummary[] }[],
  leadWorktreeId: string | null
): OrchestratorGameState {
  if (state.role !== 'lead') {
    return state
  }
  const local = state.agents.filter((agent) => !agent.remote)
  const worktrees = new Set([
    ...(leadWorktreeId ? [`${LOCAL_GAME_HOST}\0${leadWorktreeId}`] : []),
    ...state.agents.flatMap((agent) =>
      agent.worktree ? [`${agent.remote?.host ?? LOCAL_GAME_HOST}\0${agent.worktree.id}`] : []
    )
  ])
  const others = otherProjectMembersOf(hosts, {
    paneKeys: new Set(local.map((agent) => agent.paneKey)),
    worktrees
  })
  return others.length > 0 ? { ...state, otherProjectMembers: others } : state
}

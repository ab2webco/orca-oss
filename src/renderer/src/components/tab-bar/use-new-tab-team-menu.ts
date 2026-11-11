import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/store'
import { gameInboxTargetOf } from '@/components/game-inbox/game-owner-questions-client'
import { readTeamLeadRoster } from '@/components/team-panel/team-panel-lead-read'
import { teamPanelProjectOf } from '@/components/team-panel/team-panel-project'
import { teamLeadCallerOf, useTeamPanelGame } from '@/components/team-panel/use-team-panel-model'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import {
  newTabTeamMenuStateOf,
  type NewTabTeamMenuInput,
  type NewTabTeamMenuState
} from './new-tab-team-menu-state'
import { readStoredTeamLead } from './new-tab-stored-lead-read'

export type NewTabTeamMenu = {
  state: NewTabTeamMenuState
  /** The project's name, which `game.leadReopen` lists the reopened lead under. */
  projectName: string | null
  target: RuntimeClientTarget
}

type Reads = Pick<NewTabTeamMenuInput, 'liveLead' | 'storedLead'>

const UNREAD: Reads = { liveLead: 'unread', storedLead: 'unread' }

/** The + menu's team state for this worktree's project; reads the host's leads once per menu open. */
export function useNewTabTeamMenu(worktreeId: string): NewTabTeamMenu {
  const hostId = useAppStore((s) => s.activeWorkspaceExecutionHostId)
  const repoId = useAppStore((s) => s.getKnownWorktreeById(worktreeId)?.repoId ?? null)
  const projectName = useAppStore(
    (s) => (repoId ? teamPanelProjectOf(s, repoId)?.name : null) ?? null
  )
  // Why joined: a string keeps the selector stable across unrelated store writes.
  const worktreeIdList = useAppStore((s) =>
    repoId ? (teamPanelProjectOf(s, repoId)?.worktreeIds.join('\n') ?? '') : ''
  )
  const team = useTeamPanelGame(repoId)
  const target = useMemo(() => gameInboxTargetOf(hostId), [hostId])
  const [reads, setReads] = useState<Reads>(UNREAD)

  useEffect(() => {
    let live = true
    const worktreeIds = new Set(worktreeIdList.split('\n').filter(Boolean))
    void (async () => {
      // Why null on failure: a host that cannot answer keeps today's Claude Agent Teams entry.
      const liveLead = await readTeamLeadRoster(target)
        .then((roster) => teamLeadCallerOf(roster, worktreeIds))
        .catch(() => null)
      const storedLead =
        liveLead === null
          ? await readStoredTeamLead(target, worktreeId).catch(() => 'unknown' as const)
          : null
      if (live) {
        setReads({ liveLead, storedLead })
      }
    })()
    return () => {
      live = false
    }
  }, [target, worktreeId, worktreeIdList])

  const state = useMemo(
    () =>
      newTabTeamMenuStateOf({
        ...reads,
        team: team
          ? {
              lead: team.lead,
              todo: team.todo,
              ...(team.memberAgent ? { memberAgent: team.memberAgent } : {})
            }
          : null
      }),
    [reads, team]
  )
  return { state, projectName, target }
}

import { useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import { useGameLeadHandles } from '@/components/team-panel/game-lead-handles'
import { useTeamPanelModel } from '@/components/team-panel/use-team-panel-model'
import { useTeamPanelLook } from '@/components/team-panel/use-team-panel-look'
import { useSidebarTeamRosterStore } from './sidebar-team-roster'
import { useSidebarDeliveredSync } from './use-sidebar-delivered-sync'
import type { TeamPanelGameModel } from '../../../../shared/team-panel-model-types'

/**
 * Feeds the sidebar's V30 rows from the Team panel's own game.state poller (ORCA-1149).
 * Why gated twice: no agent means no lead, so no game.leads read; no live lead means no game.state read.
 */
export function SidebarTeamRosterSync(): React.JSX.Element | null {
  const hasAgent = useAppStore((s) => Object.keys(s.agentStatusByPaneKey).length > 0)
  return hasAgent ? <LeadWatch /> : null
}

function LeadWatch(): React.JSX.Element | null {
  const leads = useGameLeadHandles()
  // Why settle first: the handle store outlives a remount, and its stale lead would cost a game.state read.
  const [settled, setSettled] = useState(false)
  useEffect(() => setSettled(true), [])
  return settled && leads.size > 0 ? <RosterSubscriber /> : null
}

function RosterSubscriber(): React.JSX.Element | null {
  // Why background: it joins the panel's poller and orca.yaml read, and a panel opening still reads fresh.
  const { section } = useTeamPanelModel({ background: true })
  const look = useTeamPanelLook({ background: true })
  const team = section.kind === 'ready' && section.value.kind === 'team' ? section.value : null
  const lead = team?.lead ?? null
  const members = team?.members ?? null
  useEffect(() => {
    // Why keep the last roster: a loading or failed read says nothing new about the team.
    if (lead && members) {
      useSidebarTeamRosterStore.setState({ model: { lead, members } })
    }
  }, [lead, members])
  useEffect(() => {
    useSidebarTeamRosterStore.setState({ look })
  }, [look])
  useEffect(() => () => useSidebarTeamRosterStore.setState({ model: null }), [])
  // Why keep the last team: as with the roster, a loading read must not empty the Delivered group.
  const [kept, setKept] = useState<TeamPanelGameModel | null>(team)
  useEffect(() => {
    if (team) {
      setKept(team)
    }
  }, [team])
  return kept ? <DeliveredSync team={kept} /> : null
}

function DeliveredSync({ team }: { team: TeamPanelGameModel }): null {
  useSidebarDeliveredSync(team)
  return null
}

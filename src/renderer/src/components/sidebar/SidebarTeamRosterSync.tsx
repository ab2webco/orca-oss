import { useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import { useGameLeadHandles } from '@/components/team-panel/game-lead-handles'
import { useTeamPanelModel } from '@/components/team-panel/use-team-panel-model'
import { useTeamPanelLook } from '@/components/team-panel/use-team-panel-look'
import { useSidebarTeamRosterStore } from './sidebar-team-roster'

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

function RosterSubscriber(): null {
  // Why this hook: it joins the panel's refcounted poller, so an open panel adds no second read.
  const { section } = useTeamPanelModel()
  const look = useTeamPanelLook()
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
  return null
}

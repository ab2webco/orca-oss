import { createContext, useContext, useMemo } from 'react'
import { create } from 'zustand'
import { useAppStore } from '@/store'
import type { GamePanelLook } from '../../../../shared/orchestrator-game-panel'
import type {
  TeamLeadCard,
  TeamMemberCard,
  TeamPanelGameModel
} from '../../../../shared/team-panel-model-types'

/** A worktree card that is the game lead's or a member's: it draws V30's agent row instead. */
export type SidebarTeamRow =
  | { role: 'lead'; card: TeamLeadCard }
  | { role: 'member'; card: TeamMemberCard }

export type SidebarTeamRoster = {
  model: Pick<TeamPanelGameModel, 'lead' | 'members'> | null
  look: GamePanelLook
}

// Why a sidebar store: the roster is published by SidebarTeamRosterSync from the Team panel's shared poller.
export const useSidebarTeamRosterStore = create<SidebarTeamRoster>(() => ({
  model: null,
  look: 'game'
}))

export function teamRowOfWorktree(
  model: SidebarTeamRoster['model'],
  worktreeId: string
): SidebarTeamRow | null {
  if (!model) {
    return null
  }
  if (model.lead.worktreeId === worktreeId) {
    return { role: 'lead', card: model.lead }
  }
  const card = model.members.find((one) => one.worktreeId === worktreeId)
  return card ? { role: 'member', card } : null
}

export function useSidebarTeamRow(worktreeId: string): SidebarTeamRow | null {
  // Why cards, not the row: a selector must return a stable reference, and cards keep theirs per read.
  const lead = useSidebarTeamRosterStore((s) =>
    s.model?.lead.worktreeId === worktreeId ? s.model.lead : null
  )
  const member = useSidebarTeamRosterStore(
    (s) => s.model?.members.find((one) => one.worktreeId === worktreeId) ?? null
  )
  return useMemo<SidebarTeamRow | null>(
    () => (lead ? { role: 'lead', card: lead } : member ? { role: 'member', card: member } : null),
    [lead, member]
  )
}

export function useSidebarTeamLook(): GamePanelLook {
  return useSidebarTeamRosterStore((s) => s.look)
}

/** True inside the lead's children: a member there draws as V30's child row. */
export const SidebarTeamChildContext = createContext(false)

/** The card's team row, and whether it sits under the lead as a child row. */
export function useSidebarTeamCard(worktreeId: string): {
  row: SidebarTeamRow | null
  child: boolean
} {
  const row = useSidebarTeamRow(worktreeId)
  const underLead = useContext(SidebarTeamChildContext)
  return { row, child: underLead && row?.role === 'member' }
}

export function useSidebarTeamRowSince(row: SidebarTeamRow): number | null {
  // Why: game.state sends stateSince for members only; the lead's pane holds the same stateStartedAt.
  const leadStarted = useAppStore((s) =>
    row.role === 'lead' && row.card.since === null
      ? (s.agentStatusByPaneKey[row.card.paneKey]?.stateStartedAt ?? null)
      : null
  )
  return row.card.since ?? leadStarted
}

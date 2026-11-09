import { useMemo } from 'react'
import { create } from 'zustand'
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

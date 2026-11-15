import type { AppState } from '@/store/types'
import type { Repo } from '../../../../../../shared/repo-types'
import type { Worktree } from '../../../../../../shared/worktree/types'
import { buildAttentionByWorktree } from '../../smart-attention'
import { isWorktreeCIFailing } from '../grouping/group-keys'
import { useSidebarTeamRosterStore } from '../../sidebar-team-roster'
import type { SidebarTeamRoster } from '../../sidebar-team-roster'
import type { ProjectUrgencyInputs } from '../grouping/project-activity'
import { strongerUrgencySignal } from '../grouping/project-urgency-tier'
import type { WorkspaceUrgencySignal } from '../grouping/project-urgency-tier'
import { getProjectTierMemory } from './project-tier-memory-store'

export type UrgencySourceState = Pick<
  AppState,
  | 'tabsByWorktree'
  | 'agentStatusByPaneKey'
  | 'runtimePaneTitlesByTabId'
  | 'ptyIdsByTabId'
  | 'migrationUnsupportedByPtyId'
  | 'terminalLayoutsByTabId'
>

/**
 * What each workspace asks of the person: the Smart-sort attention classes (works under any
 * grouping), plus the team roster's account limits and open questions, which hooks do not carry.
 */
export function selectWorkspaceUrgencySignals(
  state: UrgencySourceState,
  roster: SidebarTeamRoster['model'],
  worktrees: readonly Worktree[],
  now: number
): Map<string, WorkspaceUrgencySignal> {
  const signals = new Map<string, WorkspaceUrgencySignal>()
  const attention = buildAttentionByWorktree(
    [...worktrees],
    state.tabsByWorktree,
    state.agentStatusByPaneKey,
    state.runtimePaneTitlesByTabId,
    state.ptyIdsByTabId,
    now,
    state.migrationUnsupportedByPtyId,
    state.terminalLayoutsByTabId
  )
  for (const [worktreeId, { cls }] of attention) {
    if (cls === 1 || cls === 3) {
      signals.set(worktreeId, cls === 1 ? 'question' : 'working')
    }
  }
  for (const card of roster ? [roster.lead, ...roster.members] : []) {
    const worktreeId = card.worktreeId
    if (!worktreeId) {
      continue
    }
    if (card.condition === 'limited') {
      signals.set(worktreeId, 'account-limit')
    } else if ('needsYou' in card && card.needsYou) {
      signals.set(worktreeId, strongerUrgencySignal(signals.get(worktreeId), 'question'))
    }
  }
  return signals
}

/** At risk: workspaces whose open PR fails CI, read from the live prCache only (ORCA-1213). */
export function selectCIFailingWorktreeIds(
  worktrees: readonly Worktree[],
  repoMap: Map<string, Repo>,
  prCache: Record<string, unknown> | null,
  settings: AppState['settings'] | null
): Set<string> {
  return new Set(
    worktrees
      .filter((w) => isWorktreeCIFailing(w, repoMap, prCache, settings ?? undefined))
      .map((w) => w.id)
  )
}

/** The tier inputs straight from state, for Cmd+1–9 numbering while the list is unmounted. */
export function selectProjectUrgencyInputs(
  state: UrgencySourceState & Pick<AppState, 'prCache' | 'settings'>,
  worktrees: readonly Worktree[],
  repoMap: Map<string, Repo>,
  now: number
): ProjectUrgencyInputs {
  return {
    signalByWorktreeId: selectWorkspaceUrgencySignals(
      state,
      useSidebarTeamRosterStore.getState().model,
      worktrees,
      now
    ),
    ciFailingWorktreeIds: selectCIFailingWorktreeIds(
      worktrees,
      repoMap,
      state.prCache,
      state.settings
    ),
    tierMemory: getProjectTierMemory()
  }
}

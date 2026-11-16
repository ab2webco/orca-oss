import { useMemo } from 'react'
import { useAppStore } from '@/store'
import type { Repo } from '../../../../../../shared/repo-types'
import type { Worktree } from '../../../../../../shared/worktree/types'
import { useSidebarTeamRosterStore } from '../../sidebar-team-roster'
import type { ProjectActivityInputs, ProjectUrgencyInputs } from '../grouping/project-activity'
import type { WorkspaceUrgencySignal } from '../grouping/project-urgency-tier'
import { useProjectTierMemory } from './project-tier-memory-store'
import { useIdleProjectFoldInputs } from './use-idle-project-fold-inputs'
import { useStableIdentity } from './use-stable-identity'
import {
  selectCIFailingWorktreeIds,
  selectWorkspaceUrgencySignals
} from './workspace-urgency-signals'

type Signals = ReadonlyMap<string, WorkspaceUrgencySignal>

function sameSignals(left: Signals, right: Signals): boolean {
  return left.size === right.size && [...left].every(([id, signal]) => right.get(id) === signal)
}

function sameIds(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((id) => right.has(id))
}

function useProjectUrgencyInputs(
  worktrees: readonly Worktree[],
  repoMap: Map<string, Repo>,
  now: number
): ProjectUrgencyInputs {
  // Why both epochs: sortEpoch moves on a state change (working → waiting), agentStatusEpoch on membership.
  const sortEpoch = useAppStore((s) => s.sortEpoch)
  const agentStatusEpoch = useAppStore((s) => s.agentStatusEpoch)
  const prCache = useAppStore((s) => s.prCache)
  const settings = useAppStore((s) => s.settings)
  const roster = useSidebarTeamRosterStore((s) => s.model)
  const tierMemory = useProjectTierMemory()
  const signals = useStableIdentity(
    useMemo(() => {
      void sortEpoch
      void agentStatusEpoch
      return selectWorkspaceUrgencySignals(useAppStore.getState(), roster, worktrees, now)
    }, [agentStatusEpoch, now, roster, sortEpoch, worktrees]),
    sameSignals
  )
  const ciFailing = useStableIdentity(
    useMemo(
      () => selectCIFailingWorktreeIds(worktrees, repoMap, prCache, settings),
      [prCache, repoMap, settings, worktrees]
    ),
    sameIds
  )
  return useMemo(
    () => ({ signalByWorktreeId: signals, ciFailingWorktreeIds: ciFailing, tierMemory }),
    [ciFailing, signals, tierMemory]
  )
}

/** The fold inputs plus the Needs you first tier inputs, one object for buildRows. */
export function useSidebarProjectActivityInputs(
  worktrees: readonly Worktree[],
  repoMap: Map<string, Repo>
): ProjectActivityInputs {
  const fold = useIdleProjectFoldInputs()
  const urgency = useProjectUrgencyInputs(worktrees, repoMap, fold.now)
  return useMemo(() => ({ ...fold, urgency }), [fold, urgency])
}

import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import {
  buildResumeVaultProjectGroups,
  type ResumeVaultProjectGroup,
  type ResumeVaultSourceState
} from '@/lib/resume-vault-records'

/** Selects the raw slices the vault needs (never the derived groups themselves — a
 *  selector that returns a fresh array/object every call defeats Zustand's equality
 *  check and re-renders forever) and memoizes the grouping over those stable refs.
 *
 *  The memo depends on the five slices individually, not on the selected object as a
 *  whole: `useShallow` only stabilizes the *subscription* (it re-renders only when a
 *  field actually changes), but it still returns a new object literal on every render
 *  that runs. Memoizing on that object would recompute every render — including ones
 *  the freshness check (`isSleepingAgentPaneCurrentlyWorking`'s `Date.now()`) has no
 *  business reacting to — letting a row flip Working/releasable with no store change. */
export function useResumeVaultProjectGroups(): ResumeVaultProjectGroup[] {
  const {
    sleepingAgentSessionsByPaneKey,
    worktreesByRepo,
    repos,
    agentStatusByPaneKey,
    retainedAgentsByPaneKey
  } = useAppStore(
    useShallow(
      (state): ResumeVaultSourceState => ({
        sleepingAgentSessionsByPaneKey: state.sleepingAgentSessionsByPaneKey,
        worktreesByRepo: state.worktreesByRepo,
        repos: state.repos,
        agentStatusByPaneKey: state.agentStatusByPaneKey,
        retainedAgentsByPaneKey: state.retainedAgentsByPaneKey
      })
    )
  )

  return useMemo(
    () =>
      buildResumeVaultProjectGroups({
        sleepingAgentSessionsByPaneKey,
        worktreesByRepo,
        repos,
        agentStatusByPaneKey,
        retainedAgentsByPaneKey
      }),
    [sleepingAgentSessionsByPaneKey, worktreesByRepo, repos, agentStatusByPaneKey, retainedAgentsByPaneKey]
  )
}

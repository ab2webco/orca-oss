import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { useNow } from '../../../dashboard/useNow'
import type { ProjectActivityInputs } from '../grouping/project-activity'
import { selectIdleProjectFoldInputs } from './idle-project-fold-inputs'
import { useStableIdentity } from './use-stable-identity'

// Why coarse: the window is 24 h, and every tick rebuilds the whole row model.
const FOLD_CLOCK_INTERVAL_MS = 5 * 60 * 1000

function sameInputs(left: ProjectActivityInputs, right: ProjectActivityInputs): boolean {
  return (
    left.now === right.now &&
    left.currentWorktreeId === right.currentWorktreeId &&
    left.windowMs === right.windowMs &&
    left.liveAgentWorktreeIds.size === right.liveAgentWorktreeIds.size &&
    [...left.liveAgentWorktreeIds].every((id) => right.liveAgentWorktreeIds.has(id))
  )
}

export function useIdleProjectFoldInputs(): ProjectActivityInputs {
  const now = useNow(FOLD_CLOCK_INTERVAL_MS)
  const activeWorkspaceKey = useAppStore((s) => s.activeWorkspaceKey)
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const agentStatusEpoch = useAppStore((s) => s.agentStatusEpoch)
  const windowHours = useAppStore((s) => s.settings?.sidebarActivityWindowHours)
  const next = useMemo(() => {
    void agentStatusEpoch
    // Why snapshot on agentStatusEpoch: membership changes bump it; hook pings do not repaint the list.
    const { agentStatusByPaneKey, tabsByWorktree } = useAppStore.getState()
    return selectIdleProjectFoldInputs(
      {
        activeWorkspaceKey,
        activeWorktreeId,
        agentStatusByPaneKey,
        tabsByWorktree,
        settings: { sidebarActivityWindowHours: windowHours }
      },
      now
    )
  }, [activeWorkspaceKey, activeWorktreeId, agentStatusEpoch, now, windowHours])
  // Why reuse: these inputs feed the buildRows memo; a fresh identity per epoch rebuilds every row.
  return useStableIdentity(next, sameInputs)
}

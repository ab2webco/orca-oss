import type { AppState } from '@/store/types'
import { getWorktreeIdsWithLiveAgent } from '@/lib/worktree-activity-state'
import { getActiveSidebarWorkspaceId } from '../../../../../../shared/workspace-scope'
import type { ProjectActivityInputs } from '../grouping/project-activity'

type FoldInputState = Pick<
  AppState,
  'activeWorkspaceKey' | 'activeWorktreeId' | 'agentStatusByPaneKey' | 'tabsByWorktree'
>

/** One source for the fold inputs, so the mounted list and Cmd+1–9 numbering fold alike. */
export function selectIdleProjectFoldInputs(
  state: FoldInputState,
  now: number
): ProjectActivityInputs {
  return {
    now,
    currentWorktreeId: getActiveSidebarWorkspaceId(
      state.activeWorkspaceKey,
      state.activeWorktreeId
    ),
    liveAgentWorktreeIds: getWorktreeIdsWithLiveAgent(
      state.agentStatusByPaneKey,
      state.tabsByWorktree,
      now
    )
  }
}

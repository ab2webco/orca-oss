// Why: split out of use-plane-work-item-mutations.ts (300-line cap) — owns the
// "link this work item to the current worktree" affordance for worktrees that
// were NOT created from a Plane task. Reuses updateWorktreeMeta, the same
// persisted-meta path the sidebar uses to set/clear other worktree links, so
// `--current` reads resolve afterward. Purely additive: no other link touched.
import { useCallback, useMemo } from 'react'
import { Link2 } from 'lucide-react'
import { toast } from 'sonner'

import { useAppStore } from '@/store'
import { getIndexedWorktreeMap } from '@/store/worktree-repo-index'
import { translate } from '@/i18n/i18n'
import type { PlaneWorkItem } from '../../../shared/plane-types'
import type { LinkedPlaneWorkItem } from '../../../shared/types'
import type { PlaneWorkItemActionItem } from './use-plane-work-item-mutations'

// Returns the "Link to current worktree" action, or null when there is no
// active worktree context to attach the work item to (so the affordance is
// only shown when a worktree exists).
export function usePlaneWorkItemLinkWorktreeAction(
  item: PlaneWorkItem | null
): PlaneWorkItemActionItem | null {
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const worktree = useAppStore((s) =>
    activeWorktreeId ? getIndexedWorktreeMap(s.worktreesByRepo).get(activeWorktreeId) : undefined
  )
  const updateWorktreeMeta = useAppStore((s) => s.updateWorktreeMeta)

  const worktreeId = worktree?.id ?? null
  const worktreeName = worktree?.displayName ?? ''

  const action = useCallback(() => {
    if (!item || !worktreeId) {
      return
    }
    const linked: LinkedPlaneWorkItem = {
      identifier: item.identifier,
      projectId: item.project.id,
      ...(item.workspaceId ? { workspaceId: item.workspaceId } : {}),
      ...(item.url ? { url: item.url } : {})
    }
    void updateWorktreeMeta(worktreeId, { linkedPlaneWorkItem: linked })
      .then(() =>
        toast.success(
          translate(
            'auto.components.PlaneWorkItemWorkspace.linkedToWorktree',
            'Linked {{value0}} to {{value1}}',
            { value0: item.identifier, value1: worktreeName }
          )
        )
      )
      .catch(() =>
        toast.error(
          translate(
            'auto.components.PlaneWorkItemWorkspace.linkFailed',
            'Failed to link to the worktree.'
          )
        )
      )
  }, [item, updateWorktreeMeta, worktreeId, worktreeName])

  return useMemo(() => {
    if (!item || !worktreeId) {
      return null
    }
    return {
      label: translate(
        'auto.components.PlaneWorkItemWorkspace.linkToWorktree',
        'Link to current worktree'
      ),
      icon: Link2,
      action
    }
  }, [action, item, worktreeId])
}

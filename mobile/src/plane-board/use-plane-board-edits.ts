import { useCallback, useEffect, useState } from 'react'
import type { PlaneWorkItemPriority } from '../../../src/shared/plane-types'
import type { PlaneMobileMember, PlaneMobileWorkItem } from '../tasks/plane-mobile-work-item-read'
import type { RpcClient } from '../transport/rpc-client'
import {
  EMPTY_PLANE_BOARD_EDITS,
  reconcilePlaneBoardEdits,
  restorePlaneBoardEdit,
  toPlaneWorkItemPatch,
  withPlaneBoardEdit,
  type PlaneBoardEdit,
  type PlaneBoardEditOverrides
} from './plane-board-edit-state'
import { updatePlaneWorkItem } from './plane-work-item-update'

export type PlaneBoardEditTarget = Pick<PlaneMobileWorkItem, 'id' | 'project'>

export type PlaneBoardEdits = {
  overrides: PlaneBoardEditOverrides
  editingWorkItemId: string | null
  editError: string | null
  /** The card the error belongs to; another card's sheet must not offer its retry. */
  editErrorWorkItemId: string | null
  setPriority: (item: PlaneBoardEditTarget, priority: PlaneWorkItemPriority) => Promise<void>
  /** The whole list: Plane replaces, it does not merge. */
  setAssignees: (item: PlaneBoardEditTarget, assignees: PlaneMobileMember[]) => Promise<void>
  retryEdit: () => Promise<void>
  dismissEditError: () => void
  reset: () => void
}

type Input = {
  client: RpcClient | null
  workspaceId: string | null
  items: readonly PlaneMobileWorkItem[]
  /** Re-reads the board after an unanswered write: Plane may have taken it. */
  reload: () => void
}

export function usePlaneBoardEdits({ client, workspaceId, items, reload }: Input): PlaneBoardEdits {
  const [overrides, setOverrides] = useState<PlaneBoardEditOverrides>(EMPTY_PLANE_BOARD_EDITS)
  const [editingWorkItemId, setEditingWorkItemId] = useState<string | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [failed, setFailed] = useState<{ item: PlaneBoardEditTarget; edit: PlaneBoardEdit } | null>(
    null
  )

  // Drop the optimistic edits this read already reflects; the rest stay so a
  // snapshot taken before the write cannot undo the value on screen.
  useEffect(() => {
    setOverrides((current) => reconcilePlaneBoardEdits(current, items))
  }, [items])

  const submit = useCallback(
    async (item: PlaneBoardEditTarget, edit: PlaneBoardEdit): Promise<void> => {
      if (!client) {
        return
      }
      const previous = overrides[item.id]
      setEditError(null)
      setEditingWorkItemId(item.id)
      setOverrides((current) => withPlaneBoardEdit(current, item.id, edit))
      const result = await updatePlaneWorkItem(client, {
        projectId: item.project.id,
        workItemId: item.id,
        workspaceId,
        patch: toPlaneWorkItemPatch(edit)
      })
      setEditingWorkItemId(null)
      if (result.ok) {
        setFailed(null)
        return
      }
      // Put the value back: a failed write must not leave the card claiming
      // something Plane never took.
      setOverrides((current) => restorePlaneBoardEdit(current, item.id, previous))
      setEditError(result.error)
      setFailed({ item, edit })
      if (result.deliveryUnknown) {
        reload()
      }
    },
    [client, overrides, reload, workspaceId]
  )

  return {
    overrides,
    editingWorkItemId,
    editError,
    editErrorWorkItemId: editError && failed ? failed.item.id : null,
    setPriority: useCallback((item, priority) => submit(item, { priority }), [submit]),
    setAssignees: useCallback((item, assignees) => submit(item, { assignees }), [submit]),
    retryEdit: useCallback(async () => {
      if (failed) {
        await submit(failed.item, failed.edit)
      }
    }, [failed, submit]),
    dismissEditError: useCallback(() => setEditError(null), []),
    reset: useCallback(() => {
      setOverrides(EMPTY_PLANE_BOARD_EDITS)
      setEditError(null)
      setFailed(null)
    }, [])
  }
}

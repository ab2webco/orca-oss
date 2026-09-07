import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlaneWorkItemPriority } from '../../../src/shared/plane-types'
import type { PlaneMobileMember, PlaneMobileWorkItem } from '../tasks/plane-mobile-work-item-read'
import type { RpcClient } from '../transport/rpc-client'
import {
  dropConfirmedDescriptions,
  EMPTY_PLANE_BOARD_EDITS,
  reconcilePlaneBoardEdits,
  rollbackPlaneBoardEdit,
  toPlaneWorkItemPatch,
  withPlaneBoardEdit,
  type PlaneBoardEdit,
  type PlaneBoardEditOverrides
} from './plane-board-edit-state'
import { usePlaneBoardInFlightCards } from './plane-board-in-flight-cards'
import { updatePlaneWorkItem } from './plane-work-item-update'

export type PlaneBoardEditTarget = Pick<PlaneMobileWorkItem, 'id' | 'project'>

/** The text and date fields the detail sheet edits in place. */
export type PlaneWorkItemFieldEdit = Pick<
  PlaneBoardEdit,
  'title' | 'description' | 'labelIds' | 'startDate' | 'targetDate'
>

export type PlaneBoardEdits = {
  overrides: PlaneBoardEditOverrides
  /** Cards with an edit in flight. */
  editingWorkItemIds: ReadonlySet<string>
  editError: string | null
  /** The card the error belongs to; another card's sheet must not offer its retry. */
  editErrorWorkItemId: string | null
  setPriority: (item: PlaneBoardEditTarget, priority: PlaneWorkItemPriority) => Promise<void>
  /** The whole list: Plane replaces, it does not merge. */
  setAssignees: (item: PlaneBoardEditTarget, assignees: PlaneMobileMember[]) => Promise<void>
  setFields: (item: PlaneBoardEditTarget, edit: PlaneWorkItemFieldEdit) => Promise<void>
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
  // Why a ref: two writes can start before a render lands, and each rollback needs
  // the value the card showed when its own write began, not a render-old one.
  const overridesRef = useRef(overrides)
  // Why: the server's re-read of a description is the truth once acked; its Markdown may not equal the draft.
  const confirmedDescriptionIds = useRef(new Set<string>())
  const { ids: editingWorkItemIds, begin, end } = usePlaneBoardInFlightCards()
  const [editError, setEditError] = useState<string | null>(null)
  const [failed, setFailed] = useState<{ item: PlaneBoardEditTarget; edit: PlaneBoardEdit } | null>(
    null
  )

  const updateOverrides = useCallback(
    (update: (current: PlaneBoardEditOverrides) => PlaneBoardEditOverrides): void => {
      overridesRef.current = update(overridesRef.current)
      setOverrides(overridesRef.current)
    },
    []
  )

  // Drop the optimistic edits this read already reflects; the rest stay so a
  // snapshot taken before the write cannot undo the value on screen.
  useEffect(() => {
    updateOverrides((current) => {
      const reconciled = reconcilePlaneBoardEdits(current, items)
      return dropConfirmedDescriptions(reconciled, items, confirmedDescriptionIds.current)
    })
  }, [items, updateOverrides])

  const submit = useCallback(
    async (item: PlaneBoardEditTarget, edit: PlaneBoardEdit): Promise<void> => {
      if (!client) {
        return
      }
      const previous = overridesRef.current[item.id]
      setEditError(null)
      begin(item.id)
      updateOverrides((current) => withPlaneBoardEdit(current, item.id, edit))
      const result = await updatePlaneWorkItem(client, {
        projectId: item.project.id,
        workItemId: item.id,
        workspaceId,
        patch: toPlaneWorkItemPatch(edit)
      })
      end(item.id)
      if (result.ok) {
        setFailed(null)
        if (edit.description !== undefined) {
          confirmedDescriptionIds.current.add(item.id)
          reload()
        }
        return
      }
      // Put the value back: a failed write must not leave the card claiming
      // something Plane never took.
      updateOverrides((current) => rollbackPlaneBoardEdit(current, item.id, edit, previous))
      setEditError(result.error)
      setFailed({ item, edit })
      if (result.deliveryUnknown) {
        reload()
      }
    },
    [begin, client, end, reload, updateOverrides, workspaceId]
  )

  return {
    overrides,
    editingWorkItemIds,
    editError,
    editErrorWorkItemId: editError && failed ? failed.item.id : null,
    setPriority: useCallback((item, priority) => submit(item, { priority }), [submit]),
    setAssignees: useCallback((item, assignees) => submit(item, { assignees }), [submit]),
    setFields: submit,
    retryEdit: useCallback(async () => {
      if (failed) {
        await submit(failed.item, failed.edit)
      }
    }, [failed, submit]),
    dismissEditError: useCallback(() => setEditError(null), []),
    reset: useCallback(() => {
      updateOverrides(() => EMPTY_PLANE_BOARD_EDITS)
      setEditError(null)
      setFailed(null)
    }, [updateOverrides])
  }
}

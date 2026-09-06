import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlaneMobileWorkItem } from '../tasks/plane-mobile-work-item-read'
import type { RpcClient } from '../transport/rpc-client'
import {
  EMPTY_PLANE_BOARD_MOVES,
  reconcilePlaneBoardMoves,
  rollbackPlaneBoardMove,
  withPlaneBoardMove,
  type PlaneBoardMoveOverrides
} from './plane-board-move-state'
import { usePlaneBoardInFlightCards } from './plane-board-in-flight-cards'
import { movePlaneWorkItem } from './plane-work-item-move'

export type PlaneBoardMoves = {
  overrides: PlaneBoardMoveOverrides
  /** Cards with a move in flight. */
  movingWorkItemIds: ReadonlySet<string>
  moveError: string | null
  /** The card the error belongs to; another project's board must not show it. */
  moveErrorWorkItemId: string | null
  /** Resolves true while the card still shows in `stateId` once the host answered. */
  moveWorkItem: (item: PlaneMobileWorkItem, stateId: string) => Promise<boolean>
  dismissMoveError: () => void
  reset: () => void
}

type Input = {
  client: RpcClient | null
  workspaceId: string | null
  items: readonly PlaneMobileWorkItem[]
  /** Re-reads the board after an unanswered write: Plane may have taken it. */
  reload: () => void
}

export function usePlaneBoardMoves({ client, workspaceId, items, reload }: Input): PlaneBoardMoves {
  const [overrides, setOverrides] = useState<PlaneBoardMoveOverrides>(EMPTY_PLANE_BOARD_MOVES)
  // Why a ref: two moves can start before a render lands, and each rollback needs
  // the column the card showed when its own write began, not a render-old one.
  const overridesRef = useRef(overrides)
  const { ids: movingWorkItemIds, begin, end } = usePlaneBoardInFlightCards()
  const [moveError, setMoveError] = useState<{ workItemId: string; message: string } | null>(null)

  const updateOverrides = useCallback(
    (update: (current: PlaneBoardMoveOverrides) => PlaneBoardMoveOverrides): void => {
      overridesRef.current = update(overridesRef.current)
      setOverrides(overridesRef.current)
    },
    []
  )

  // Drop the optimistic moves this read already reflects; the rest stay so a
  // snapshot taken before the write cannot undo the card on screen.
  useEffect(() => {
    updateOverrides((current) => reconcilePlaneBoardMoves(current, items))
  }, [items, updateOverrides])

  const moveWorkItem = useCallback(
    async (item: PlaneMobileWorkItem, stateId: string): Promise<boolean> => {
      if (!client) {
        return false
      }
      const previousStateId = overridesRef.current[item.id]
      setMoveError(null)
      begin(item.id)
      updateOverrides((current) => withPlaneBoardMove(current, item.id, stateId))
      const result = await movePlaneWorkItem(client, {
        projectId: item.project.id,
        workItemId: item.id,
        stateId,
        workspaceId
      })
      end(item.id)
      if (result.ok) {
        return true
      }
      // Put the card back where it was: a failed write must not leave the board
      // claiming a move Plane never took.
      updateOverrides((current) =>
        rollbackPlaneBoardMove(current, item.id, stateId, previousStateId)
      )
      setMoveError({ workItemId: item.id, message: result.error })
      if (result.deliveryUnknown) {
        // Plane may have taken the move after all; only a re-read can tell.
        reload()
      }
      return false
    },
    [begin, client, end, reload, updateOverrides, workspaceId]
  )

  return {
    overrides,
    movingWorkItemIds,
    moveError: moveError?.message ?? null,
    moveErrorWorkItemId: moveError?.workItemId ?? null,
    moveWorkItem,
    dismissMoveError: useCallback(() => setMoveError(null), []),
    reset: useCallback(() => {
      updateOverrides(() => EMPTY_PLANE_BOARD_MOVES)
      setMoveError(null)
    }, [updateOverrides])
  }
}

import { useCallback, useState } from 'react'
import type { PlaneMobileWorkItem } from '../tasks/plane-mobile-work-item-read'
import type { RpcClient } from '../transport/rpc-client'
import {
  beginPlaneBoardCreate,
  IDLE_PLANE_BOARD_CREATE,
  settlePlaneBoardCreate,
  type PlaneBoardCreateState
} from './plane-board-create-state'
import { createPlaneWorkItem } from './plane-work-item-create'
import { unansweredPlaneCreateLanded } from './plane-write-failure'

export type PlaneBoardCreate = {
  create: PlaneBoardCreateState
  /** Creates a card in the active column; resolves true once Plane has it. */
  createCard: (name: string) => Promise<boolean>
  dismissCreateError: () => void
}

type Input = {
  client: RpcClient | null
  projectId: string | null
  workspaceId: string | null
  /** The column the card lands in: the one the user is looking at. */
  stateId: string | null
  items: readonly PlaneMobileWorkItem[]
  /** Re-reads the board; resolves the items it put on screen, or null when it lost to a newer read. */
  reload: () => Promise<PlaneMobileWorkItem[] | null>
}

export function usePlaneBoardCreate({
  client,
  projectId,
  workspaceId,
  stateId,
  items,
  reload
}: Input): PlaneBoardCreate {
  const [create, setCreate] = useState<PlaneBoardCreateState>(IDLE_PLANE_BOARD_CREATE)

  const createCard = useCallback(
    async (name: string): Promise<boolean> => {
      if (!client || !projectId || !stateId) {
        return false
      }
      const knownIds = new Set(items.map((item) => item.id))
      setCreate(beginPlaneBoardCreate())
      const result = await createPlaneWorkItem(client, { projectId, workspaceId, name, stateId })
      if (!result.ok && result.deliveryUnknown) {
        // Still pending while the board is re-read: "Try again" on a create Plane
        // did take would make the card twice.
        const fresh = await reload()
        const landed = fresh !== null && unansweredPlaneCreateLanded(fresh, knownIds, stateId, name)
        setCreate(landed ? IDLE_PLANE_BOARD_CREATE : settlePlaneBoardCreate(result))
        return landed
      }
      setCreate(settlePlaneBoardCreate(result))
      if (result.ok) {
        // The create reply carries no card; a silent re-read puts it on the board.
        void reload()
      }
      return result.ok
    },
    [client, items, projectId, reload, stateId, workspaceId]
  )

  return {
    create,
    createCard,
    dismissCreateError: useCallback(() => setCreate(IDLE_PLANE_BOARD_CREATE), [])
  }
}

import { useCallback, useState } from 'react'
import type { PlaneMobileState } from '../tasks/plane-mobile-work-item-read'
import type { RpcClient } from '../transport/rpc-client'
import { arePlaneColumnsEditableByHost } from './plane-board-writes-capability'
import { renamePlaneColumn } from './plane-column-edit'
import type { PlaneWriteFailure } from './plane-write-failure'

export type PlaneBoardColumns = {
  /** False on a host that would refuse the state methods; the board shows no column menu. */
  canEditColumns: boolean
  /** Resolves true once the board shows the new name. */
  renameColumn: (stateId: string, name: string) => Promise<boolean>
  /** Columns with a write in flight. */
  editingStateIds: ReadonlySet<string>
  columnError: { stateId: string; message: string } | null
  dismissColumnError: () => void
}

type Input = {
  client: RpcClient | null
  projectId: string | null
  workspaceId: string | null
  capabilities: readonly string[] | undefined
  /** Re-reads the column metadata: the states it drew, 'stale' when a newer read owns the screen, 'failed' on error. */
  reloadStates: () => Promise<PlaneMobileState[] | 'stale' | 'failed'>
}

const NO_STATES: ReadonlySet<string> = new Set()
const REREAD_FAILED_MESSAGE = 'Renamed, but the board could not be re-read. Pull to refresh.'

/** After an unanswered write, the re-read decides: a change already on the board is the
 *  success whose reply got lost, and retrying it blind could apply it twice. */
async function settleColumnWrite(
  result: { ok: true } | PlaneWriteFailure,
  reloadStates: Input['reloadStates'],
  landed: (states: readonly PlaneMobileState[]) => boolean
): Promise<string | null> {
  if (result.ok) {
    return (await reloadStates()) === 'failed' ? REREAD_FAILED_MESSAGE : null
  }
  if (result.deliveryUnknown) {
    const fresh = await reloadStates()
    if (fresh === 'stale' || (fresh !== 'failed' && landed(fresh))) {
      return null
    }
  }
  return result.error
}

export function usePlaneBoardColumns({
  client,
  projectId,
  workspaceId,
  capabilities,
  reloadStates
}: Input): PlaneBoardColumns {
  const [editingStateIds, setEditingStateIds] = useState<ReadonlySet<string>>(NO_STATES)
  const [columnError, setColumnError] = useState<{ stateId: string; message: string } | null>(null)

  const track = useCallback((stateId: string, inFlight: boolean) => {
    setEditingStateIds((current) => {
      const next = new Set(current)
      if (inFlight) {
        next.add(stateId)
      } else {
        next.delete(stateId)
      }
      return next
    })
  }, [])

  const renameColumn = useCallback(
    async (stateId: string, name: string): Promise<boolean> => {
      if (!client || !projectId) {
        return false
      }
      const trimmed = name.trim()
      setColumnError((prev) => (prev?.stateId === stateId ? null : prev))
      track(stateId, true)
      const result = await renamePlaneColumn(client, { projectId, workspaceId, stateId, name })
      const error = await settleColumnWrite(result, reloadStates, (states) =>
        states.some((state) => state.id === stateId && state.name === trimmed)
      )
      track(stateId, false)
      setColumnError((prev) => (error === null ? prev : { stateId, message: error }))
      // An ok stands even when the re-read failed: the rename landed, the board just cannot show it yet.
      return result.ok || error === null
    },
    [client, projectId, reloadStates, track, workspaceId]
  )

  return {
    canEditColumns: arePlaneColumnsEditableByHost(capabilities),
    renameColumn,
    editingStateIds,
    columnError,
    dismissColumnError: useCallback(() => setColumnError(null), [])
  }
}

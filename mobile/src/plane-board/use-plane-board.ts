import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import { fetchPlaneStates } from '../tasks/plane-mobile-task-source'
import type { PlaneMobileState, PlaneMobileWorkItem } from '../tasks/plane-mobile-work-item-read'
import { buildPlaneBoardColumns, type PlaneBoardColumn } from './plane-board-columns'
import { applyPlaneBoardMoves } from './plane-board-move-state'
import { resolvePlaneBoardEmptyState, type PlaneBoardEmptyState } from './plane-board-empty-state'
import { isPlaneBoardFiltered, type PlaneBoardScope } from './plane-board-scope'
import { isPlaneBoardWritableByHost } from './plane-board-writes-capability'
import { applyPlaneBoardEdits } from './plane-board-edit-state'
import { usePlaneBoardAssignees, type PlaneBoardAssignees } from './use-plane-board-assignees'
import {
  usePlaneBoardCommentArea,
  type PlaneBoardCommentArea
} from './use-plane-board-comment-area'
import { usePlaneBoardCreate, type PlaneBoardCreate } from './use-plane-board-create'
import { usePlaneBoardEdits, type PlaneBoardEdits } from './use-plane-board-edits'
import { usePlaneBoardMoves, type PlaneBoardMoves } from './use-plane-board-moves'

export type PlaneBoardStatus = 'idle' | 'loading' | 'ready' | 'error'

/** The rows the Tasks screen already read. Both views project from this one array, so
 *  switching to the board is a reprojection and never a second read (ORCA-417). */
export type PlaneBoardRows = {
  items: readonly PlaneMobileWorkItem[]
  /** The Tasks screen's read is in flight; with no rows yet, that is the board's spinner. */
  loading: boolean
  refreshing: boolean
  /** Re-reads the Tasks screen's rows and resolves with them, so a write can reconcile. */
  refresh: () => Promise<PlaneMobileWorkItem[] | null>
}

export type PlaneBoard = Omit<PlaneBoardEdits, 'overrides' | 'reset'> &
  Omit<PlaneBoardMoves, 'overrides' | 'reset' | 'moveWorkItem'> &
  Omit<PlaneBoardCommentArea, 'reset'> &
  PlaneBoardAssignees &
  PlaneBoardCreate & {
    status: PlaneBoardStatus
    error: string | null
    refreshing: boolean
    projectId: string | null
    projectName: string | null
    columns: PlaneBoardColumn[]
    activeColumn: PlaneBoardColumn | null
    activeStateId: string | null
    emptyState: PlaneBoardEmptyState | null
    /** The state metadata for this project is still in flight, so the columns are only
     *  the ones the cards themselves derive — not yet the project's real board. */
    columnsPending: boolean
    /** False on a host that would refuse the create; the screen shows no "+" at all. */
    canCreate: boolean
    /** Priority edits ride plane.updateWorkItem, the same gate as create. */
    canEdit: boolean
    selectColumn: (stateId: string) => void
    refresh: () => void
    /** Resolves true when the move stuck (or was a no-op), false when it was rolled back. */
    moveWorkItem: (item: PlaneMobileWorkItem, stateId: string) => Promise<boolean>
  }

type LoadedStates = {
  /** The project these states describe; another project's columns are never shown. */
  projectId: string | null
  states: PlaneMobileState[]
}

const EMPTY_STATES: LoadedStates = { projectId: null, states: [] }
const NO_ITEMS: PlaneMobileWorkItem[] = []

export function usePlaneBoard(
  client: RpcClient | null,
  capabilities: readonly string[] | undefined,
  scope: PlaneBoardScope,
  rows: PlaneBoardRows
): PlaneBoard {
  const { enabled, planeConnected, workspaceId, projectId, projectName } = scope
  const { items, loading: rowsLoading, refreshing, refresh: refreshRows } = rows
  const readable = client !== null && enabled && planeConnected && projectId !== null
  const [loadedStates, setLoadedStates] = useState<LoadedStates>(EMPTY_STATES)
  const [statesError, setStatesError] = useState<string | null>(null)
  // Keyed by project so a project change lands on the first column without an effect.
  const [activeSelection, setActiveSelection] = useState<{
    projectId: string | null
    stateId: string
  } | null>(null)
  const activeStateId = activeSelection?.projectId === projectId ? activeSelection.stateId : null
  const generationRef = useRef(0)

  // Silent on purpose: the cards are already here, so the column metadata must never
  // replace a drawn board with a spinner. Until it lands, derived columns carry the cards.
  const loadStates = useCallback(async (): Promise<void> => {
    const generation = generationRef.current + 1
    generationRef.current = generation
    if (!client || !enabled || !planeConnected || !projectId) {
      setLoadedStates(EMPTY_STATES)
      setStatesError(null)
      return
    }
    try {
      const states = await fetchPlaneStates(client, projectId, workspaceId)
      if (generationRef.current !== generation) {
        return
      }
      setLoadedStates({ projectId, states })
      setStatesError(null)
    } catch (err) {
      if (generationRef.current !== generation) {
        return
      }
      setLoadedStates({ projectId, states: [] })
      setStatesError(err instanceof Error ? err.message : 'Failed to load the Plane board')
    }
  }, [client, enabled, planeConnected, projectId, workspaceId])

  useEffect(() => {
    void loadStates()
  }, [loadStates])

  // Rows of another project never render under this one. In list mode the scope is the
  // open card's project, so this is also what the detail sheet's writes reconcile against.
  const visibleItems = useMemo(() => {
    if (!readable) {
      return NO_ITEMS
    }
    return projectId === null ? [...items] : items.filter((item) => item.project.id === projectId)
  }, [items, projectId, readable])
  const states = loadedStates.projectId === projectId ? loadedStates.states : EMPTY_STATES.states

  const reload = useCallback(() => refreshRows(), [refreshRows])
  // Destructured so the spread below cannot leak overrides/reset onto the board. reset is
  // intentionally dropped: nothing resets these on the mobile board (see note below).
  const {
    overrides,
    reset: _resetEdits,
    ...editControls
  } = usePlaneBoardEdits({ client, workspaceId, items: visibleItems, reload })
  const {
    overrides: moves,
    reset: _resetMoves,
    moveWorkItem: submitMove,
    ...moveControls
  } = usePlaneBoardMoves({ client, workspaceId, items: visibleItems, reload })
  const { reset: _resetComments, ...commentArea } = usePlaneBoardCommentArea({
    client,
    workspaceId,
    capabilities
  })
  // Why not reset on !enabled: enabled drops on any relay blip (it requires a live
  // connection), and resetComments would wipe the body of a comment the host rejected —
  // the PM's only copy, kept on purpose since ORCA-367. Optimistic overrides are keyed by
  // card and reconciled on every read, so they self-clean; there is nothing to reset here.
  const assignees = usePlaneBoardAssignees({ client, projectId, workspaceId, capabilities })

  const columns = useMemo(
    () =>
      buildPlaneBoardColumns(
        states,
        applyPlaneBoardEdits(applyPlaneBoardMoves(visibleItems, moves, states), overrides)
      ),
    [overrides, visibleItems, states, moves]
  )
  const activeColumn = useMemo(
    () => columns.find((column) => column.stateId === activeStateId) ?? columns[0] ?? null,
    [activeStateId, columns]
  )

  // Until the states land, the columns are whatever the cards derive; "Move to" must not
  // read that as the project's whole board.
  const columnsPending = readable && loadedStates.projectId !== projectId
  const error = readable ? statesError : null
  // Cards first: with rows on screen there is a board to draw, so only a board with
  // nothing loaded spins — and an empty project settles on its empty state instead.
  const status: PlaneBoardStatus = !readable
    ? 'idle'
    : error !== null
      ? 'error'
      : visibleItems.length === 0 && rowsLoading
        ? 'loading'
        : 'ready'

  const filtered = isPlaneBoardFiltered(scope)
  const emptyState = useMemo(
    () =>
      status === 'loading'
        ? null
        : resolvePlaneBoardEmptyState({
            planeConnected,
            projectId,
            projectName,
            columns,
            activeColumn,
            filtered,
            // The rows arrive filtered by the list, so what it dropped is not here to count.
            hiddenCount: null
          }),
    [activeColumn, columns, filtered, planeConnected, projectId, projectName, status]
  )

  // Follows the card to its new column, and back only if the user is still looking there.
  const moveWorkItem = useCallback(
    async (item: PlaneMobileWorkItem, stateId: string): Promise<boolean> => {
      if (stateId === item.state.id) {
        return true
      }
      const previousStateId = item.state.id
      setActiveSelection({ projectId, stateId })
      const kept = await submitMove(item, stateId)
      if (!kept) {
        setActiveSelection((current) =>
          current?.stateId === stateId ? { projectId, stateId: previousStateId } : current
        )
      }
      return kept
    },
    [projectId, submitMove]
  )

  const creation = usePlaneBoardCreate({
    client,
    projectId,
    workspaceId,
    stateId: activeColumn?.stateId ?? null,
    items: visibleItems,
    reload
  })

  return {
    status,
    error,
    refreshing,
    projectId,
    projectName,
    columns,
    activeColumn,
    activeStateId: activeColumn?.stateId ?? null,
    emptyState,
    columnsPending,
    canCreate: isPlaneBoardWritableByHost(capabilities),
    canEdit: isPlaneBoardWritableByHost(capabilities),
    ...editControls,
    ...moveControls,
    ...assignees,
    ...commentArea,
    ...creation,
    selectColumn: useCallback(
      (stateId: string) => setActiveSelection({ projectId, stateId }),
      [projectId]
    ),
    // Retries the column metadata too: an error here is the states read, not the rows.
    refresh: useCallback(() => {
      void refreshRows()
      void loadStates()
    }, [loadStates, refreshRows]),
    moveWorkItem
  }
}

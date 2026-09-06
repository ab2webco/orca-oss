import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import { fetchPlaneStates, fetchPlaneWorkItems } from '../tasks/plane-mobile-task-source'
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
    /** False on a host that would refuse the create; the screen shows no "+" at all. */
    canCreate: boolean
    /** Priority edits ride plane.updateWorkItem, the same gate as create. */
    canEdit: boolean
    selectColumn: (stateId: string) => void
    refresh: () => void
    /** Resolves true when the move stuck (or was a no-op), false when it was rolled back. */
    moveWorkItem: (item: PlaneMobileWorkItem, stateId: string) => Promise<boolean>
  }

type Loaded = {
  /** The project these rows belong to; rows of another project are never shown. */
  projectId: string | null
  states: PlaneMobileState[]
  items: PlaneMobileWorkItem[]
}

const EMPTY_LOADED: Loaded = { projectId: null, states: [], items: [] }

export function usePlaneBoard(
  client: RpcClient | null,
  capabilities: readonly string[] | undefined,
  scope: PlaneBoardScope
): PlaneBoard {
  const { enabled, planeConnected, workspaceId, projectId, projectName, filter, query } = scope
  const [loaded, setLoaded] = useState<Loaded>(EMPTY_LOADED)
  // A mount that is going to read starts on the spinner, so no empty board flashes before it (ORCA-387).
  const initialStatus: PlaneBoardStatus =
    client !== null && enabled && planeConnected && projectId !== null ? 'loading' : 'idle'
  const [status, setStatusState] = useState<PlaneBoardStatus>(initialStatus)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  // Keyed by project so a project change lands on the first column without an effect.
  const [activeSelection, setActiveSelection] = useState<{
    projectId: string | null
    stateId: string
  } | null>(null)
  const activeStateId = activeSelection?.projectId === projectId ? activeSelection.stateId : null
  const generationRef = useRef(0)
  // Mirrored so the disconnect branch can read the live status without load depending on it (ORCA-387).
  const statusRef = useRef<PlaneBoardStatus>(initialStatus)
  const setStatus = useCallback((next: PlaneBoardStatus) => {
    statusRef.current = next
    setStatusState(next)
  }, [])

  // Resolves the items it put on screen, or null when it lost to a newer read.
  const load = useCallback(
    async (options: { silent?: boolean } = {}): Promise<PlaneMobileWorkItem[] | null> => {
      const generation = generationRef.current + 1
      generationRef.current = generation
      if (!client || !enabled || !planeConnected || !projectId) {
        // A superseded in-flight silent read skips its own finally (isCurrent() is now false),
        // so clear the pull-to-refresh spinner here or it sticks forever (ORCA-387).
        setRefreshing(false)
        // A spinner already up and no longer able to read becomes a visible error, not a pinned spinner (ORCA-387).
        if (statusRef.current === 'loading') {
          setError('Lost the connection to the host')
          setStatus('error')
        } else {
          setError(null)
          setStatus('idle')
        }
        return null
      }
      const isCurrent = (): boolean => generationRef.current === generation
      if (options.silent) {
        setRefreshing(true)
      } else {
        setStatus('loading')
      }
      setError(null)
      try {
        const [states, items] = await Promise.all([
          fetchPlaneStates(client, projectId, workspaceId),
          fetchPlaneWorkItems(client, { query, filter, projectId, workspaceId })
        ])
        if (!isCurrent()) {
          return null
        }
        setLoaded({ projectId, states, items })
        setStatus('ready')
        return items
      } catch (err) {
        if (!isCurrent()) {
          return null
        }
        setError(err instanceof Error ? err.message : 'Failed to load the Plane board')
        setStatus('error')
        return null
      } finally {
        if (isCurrent()) {
          setRefreshing(false)
        }
      }
    },
    [client, enabled, filter, planeConnected, projectId, query, setStatus, workspaceId]
  )

  useEffect(() => {
    void load()
  }, [load])

  // Rows read for another project stay cached for its next open but never render.
  const current = loaded.projectId === projectId ? loaded : EMPTY_LOADED

  const reload = useCallback(() => load({ silent: true }), [load])
  // Destructured so the spread below cannot leak overrides/reset onto the board. reset is
  // intentionally dropped: nothing resets these on the mobile board (see note below).
  const {
    overrides,
    reset: _resetEdits,
    ...editControls
  } = usePlaneBoardEdits({ client, workspaceId, items: current.items, reload })
  const {
    overrides: moves,
    reset: _resetMoves,
    moveWorkItem: submitMove,
    ...moveControls
  } = usePlaneBoardMoves({ client, workspaceId, items: current.items, reload })
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
        current.states,
        applyPlaneBoardEdits(applyPlaneBoardMoves(current.items, moves, current.states), overrides)
      ),
    [overrides, current.items, current.states, moves]
  )
  const activeColumn = useMemo(
    () => columns.find((column) => column.stateId === activeStateId) ?? columns[0] ?? null,
    [activeStateId, columns]
  )

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
            // The host applied the filter, so what it hid cannot be counted here.
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
    items: current.items,
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
    refresh: useCallback(() => void reload(), [reload]),
    moveWorkItem
  }
}

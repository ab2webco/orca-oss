import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import {
  fetchPlaneProjects,
  fetchPlaneStates,
  fetchPlaneWorkItems,
  readPlaneAvailability,
  type PlaneMobileAvailability
} from '../tasks/plane-mobile-task-source'
import type {
  PlaneMobileProject,
  PlaneMobileState,
  PlaneMobileWorkItem
} from '../tasks/plane-mobile-work-item-read'
import { buildPlaneBoardColumns, type PlaneBoardColumn } from './plane-board-columns'
import {
  applyPlaneBoardMoves,
  EMPTY_PLANE_BOARD_MOVES,
  reconcilePlaneBoardMoves,
  withoutPlaneBoardMove,
  withPlaneBoardMove,
  type PlaneBoardMoveOverrides
} from './plane-board-move-state'
import { resolvePlaneBoardEmptyState, type PlaneBoardEmptyState } from './plane-board-empty-state'
import { movePlaneWorkItem } from './plane-work-item-move'

export type PlaneBoardStatus = 'idle' | 'loading' | 'ready' | 'error'

export type PlaneBoard = {
  status: PlaneBoardStatus
  error: string | null
  moveError: string | null
  refreshing: boolean
  projects: PlaneMobileProject[]
  projectId: string | null
  projectName: string | null
  columns: PlaneBoardColumn[]
  activeColumn: PlaneBoardColumn | null
  activeStateId: string | null
  emptyState: PlaneBoardEmptyState | null
  movingWorkItemId: string | null
  selectProject: (projectId: string) => void
  selectColumn: (stateId: string) => void
  refresh: () => void
  moveWorkItem: (item: PlaneMobileWorkItem, stateId: string) => Promise<void>
  dismissMoveError: () => void
}

type Loaded = {
  availability: PlaneMobileAvailability
  projects: PlaneMobileProject[]
  states: PlaneMobileState[]
  items: PlaneMobileWorkItem[]
}

const EMPTY_LOADED: Loaded = {
  availability: { supported: false, connected: false, status: null },
  projects: [],
  states: [],
  items: []
}

export function usePlaneBoard(
  client: RpcClient | null,
  connected: boolean,
  capabilities: readonly string[] | undefined
): PlaneBoard {
  const [loaded, setLoaded] = useState<Loaded>(EMPTY_LOADED)
  const [status, setStatus] = useState<PlaneBoardStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [moveError, setMoveError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [activeStateId, setActiveStateId] = useState<string | null>(null)
  const [moves, setMoves] = useState<PlaneBoardMoveOverrides>(EMPTY_PLANE_BOARD_MOVES)
  const [movingWorkItemId, setMovingWorkItemId] = useState<string | null>(null)
  const generationRef = useRef(0)

  const load = useCallback(
    async (options: { silent?: boolean } = {}): Promise<void> => {
      if (!client || !connected) {
        return
      }
      const generation = generationRef.current + 1
      generationRef.current = generation
      const isCurrent = (): boolean => generationRef.current === generation
      if (options.silent) {
        setRefreshing(true)
      } else {
        setStatus('loading')
      }
      setError(null)
      try {
        const availability = await readPlaneAvailability(capabilities, () =>
          client.sendRequest('plane.status')
        )
        if (!isCurrent()) {
          return
        }
        if (!availability.connected) {
          setLoaded({ ...EMPTY_LOADED, availability })
          setStatus('ready')
          return
        }
        const workspaceId =
          availability.status?.selectedWorkspaceId ??
          availability.status?.activeWorkspaceId ??
          availability.status?.workspaces[0]?.id ??
          null
        const projects = await fetchPlaneProjects(client, workspaceId)
        if (!isCurrent()) {
          return
        }
        const nextProjectId = projectId ?? projects[0]?.id ?? null
        if (!nextProjectId) {
          setLoaded({ availability, projects, states: [], items: [] })
          setStatus('ready')
          return
        }
        const [states, items] = await Promise.all([
          fetchPlaneStates(client, nextProjectId, workspaceId),
          fetchPlaneWorkItems(client, {
            query: '',
            filter: 'all',
            projectId: nextProjectId,
            workspaceId
          })
        ])
        if (!isCurrent()) {
          return
        }
        setProjectId(nextProjectId)
        setLoaded({ availability, projects, states, items })
        // Drop the optimistic moves this read already reflects; the rest stay so
        // a snapshot taken before the write cannot undo the card on screen.
        setMoves((current) => reconcilePlaneBoardMoves(current, items))
        setStatus('ready')
      } catch (err) {
        if (!isCurrent()) {
          return
        }
        setError(err instanceof Error ? err.message : 'Failed to load the Plane board')
        setStatus('error')
      } finally {
        if (isCurrent()) {
          setRefreshing(false)
        }
      }
    },
    [capabilities, client, connected, projectId]
  )

  useEffect(() => {
    void load()
  }, [load])

  const workspaceId = useMemo(
    () =>
      loaded.availability.status?.selectedWorkspaceId ??
      loaded.availability.status?.activeWorkspaceId ??
      loaded.availability.status?.workspaces[0]?.id ??
      null,
    [loaded.availability]
  )

  const columns = useMemo(
    () =>
      buildPlaneBoardColumns(
        loaded.states,
        applyPlaneBoardMoves(loaded.items, moves, loaded.states)
      ),
    [loaded.items, loaded.states, moves]
  )
  const activeColumn = useMemo(
    () => columns.find((column) => column.stateId === activeStateId) ?? columns[0] ?? null,
    [activeStateId, columns]
  )
  const projectName = useMemo(() => {
    const project = loaded.projects.find((entry) => entry.id === projectId)
    return project ? project.name || project.identifier : null
  }, [loaded.projects, projectId])

  const emptyState = useMemo(
    () =>
      status === 'loading'
        ? null
        : resolvePlaneBoardEmptyState({
            planeConnected: loaded.availability.connected,
            projectId,
            projectName,
            columns,
            activeColumn,
            // Phase 1 has no board-side filter yet; the input stays so the
            // filter-empty case cannot silently collapse into board-empty.
            filtered: false,
            unfilteredCount: loaded.items.length
          }),
    [
      activeColumn,
      columns,
      loaded.availability.connected,
      loaded.items.length,
      projectId,
      projectName,
      status
    ]
  )

  const moveWorkItem = useCallback(
    async (item: PlaneMobileWorkItem, stateId: string): Promise<void> => {
      if (!client || stateId === item.state.id) {
        return
      }
      const previousStateId = item.state.id
      setMoveError(null)
      setMovingWorkItemId(item.id)
      setMoves((current) => withPlaneBoardMove(current, item.id, stateId))
      setActiveStateId(stateId)
      const result = await movePlaneWorkItem(client, {
        projectId: item.project.id,
        workItemId: item.id,
        stateId,
        workspaceId
      })
      setMovingWorkItemId(null)
      if (result.ok) {
        return
      }
      // Put the card back where it was: a failed write must not leave the board
      // claiming a move Plane never took.
      setMoves((current) => withoutPlaneBoardMove(current, item.id))
      setActiveStateId(previousStateId)
      setMoveError(result.error)
    },
    [client, workspaceId]
  )

  return {
    status,
    error,
    moveError,
    refreshing,
    projects: loaded.projects,
    projectId,
    projectName,
    columns,
    activeColumn,
    activeStateId: activeColumn?.stateId ?? null,
    emptyState,
    movingWorkItemId,
    selectProject: useCallback((next: string) => {
      setProjectId(next)
      setActiveStateId(null)
      setMoves(EMPTY_PLANE_BOARD_MOVES)
    }, []),
    selectColumn: useCallback((stateId: string) => setActiveStateId(stateId), []),
    refresh: useCallback(() => void load({ silent: true }), [load]),
    moveWorkItem,
    dismissMoveError: useCallback(() => setMoveError(null), [])
  }
}

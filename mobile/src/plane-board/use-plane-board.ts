import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import {
  fetchPlaneProjects,
  fetchPlaneStates,
  fetchPlaneWorkItems,
  readPlaneAvailability,
  type PlaneMobileAvailability
} from '../tasks/plane-mobile-task-source'
import {
  resolvePlaneWorkspaceId,
  type PlaneMobileProject,
  type PlaneMobileState,
  type PlaneMobileWorkItem
} from '../tasks/plane-mobile-work-item-read'
import { buildPlaneBoardColumns, type PlaneBoardColumn } from './plane-board-columns'
import { applyPlaneBoardMoves } from './plane-board-move-state'
import { resolvePlaneBoardEmptyState, type PlaneBoardEmptyState } from './plane-board-empty-state'
import {
  arePlaneMembersListableByHost,
  isPlaneBoardWritableByHost
} from './plane-board-writes-capability'
import { applyPlaneBoardEdits } from './plane-board-edit-state'
import { usePlaneBoardComments, type PlaneBoardComments } from './use-plane-board-comments'
import { usePlaneBoardCreate, type PlaneBoardCreate } from './use-plane-board-create'
import { usePlaneBoardEdits, type PlaneBoardEdits } from './use-plane-board-edits'
import { usePlaneBoardMoves, type PlaneBoardMoves } from './use-plane-board-moves'
import { usePlaneMembers, type PlaneMembers } from './use-plane-members'

export type PlaneBoardStatus = 'idle' | 'loading' | 'ready' | 'error'

export type PlaneBoard = Omit<PlaneBoardEdits, 'overrides' | 'reset'> &
  Omit<PlaneBoardMoves, 'overrides' | 'reset' | 'moveWorkItem'> &
  Omit<PlaneBoardComments, 'reset'> &
  PlaneBoardCreate & {
    status: PlaneBoardStatus
    error: string | null
    refreshing: boolean
    projects: PlaneMobileProject[]
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
    /** False on a host that refuses plane.listMembers; no assignee picker renders at all. */
    canAssign: boolean
    /** Comments ride the same host gate as create; write-only, no thread is read. */
    canComment: boolean
    members: PlaneMembers['members']
    membersStatus: PlaneMembers['status']
    loadMembers: () => void
    selectProject: (projectId: string) => void
    selectColumn: (stateId: string) => void
    refresh: () => void
    moveWorkItem: (item: PlaneMobileWorkItem, stateId: string) => Promise<void>
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
  const [refreshing, setRefreshing] = useState(false)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [activeStateId, setActiveStateId] = useState<string | null>(null)
  const generationRef = useRef(0)

  // Resolves the items it put on screen, or null when it lost to a newer read.
  const load = useCallback(
    async (options: { silent?: boolean } = {}): Promise<PlaneMobileWorkItem[] | null> => {
      if (!client || !connected) {
        return null
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
          return null
        }
        if (!availability.connected) {
          setLoaded({ ...EMPTY_LOADED, availability })
          setStatus('ready')
          return []
        }
        const workspaceId = resolvePlaneWorkspaceId(availability.status)
        const projects = await fetchPlaneProjects(client, workspaceId)
        if (!isCurrent()) {
          return null
        }
        const nextProjectId = projectId ?? projects[0]?.id ?? null
        if (!nextProjectId) {
          setLoaded({ availability, projects, states: [], items: [] })
          setStatus('ready')
          return []
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
          return null
        }
        setProjectId(nextProjectId)
        setLoaded({ availability, projects, states, items })
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
    [capabilities, client, connected, projectId]
  )

  useEffect(() => {
    void load()
  }, [load])

  const workspaceId = useMemo(
    () => resolvePlaneWorkspaceId(loaded.availability.status),
    [loaded.availability]
  )

  const reload = useCallback(() => load({ silent: true }), [load])
  // Destructured so the spread below cannot leak overrides/reset onto the board.
  const {
    overrides,
    reset: resetEdits,
    ...editControls
  } = usePlaneBoardEdits({ client, workspaceId, items: loaded.items, reload })
  const {
    overrides: moves,
    reset: resetMoves,
    moveWorkItem: submitMove,
    ...moveControls
  } = usePlaneBoardMoves({ client, workspaceId, items: loaded.items, reload })
  const { reset: resetComments, ...commentControls } = usePlaneBoardComments({
    client,
    workspaceId
  })
  const canAssign = arePlaneMembersListableByHost(capabilities)
  const members = usePlaneMembers(client, projectId, workspaceId)

  const columns = useMemo(
    () =>
      buildPlaneBoardColumns(
        loaded.states,
        applyPlaneBoardEdits(applyPlaneBoardMoves(loaded.items, moves, loaded.states), overrides)
      ),
    [overrides, loaded.items, loaded.states, moves]
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

  // Follows the card to its new column, and back only if the user is still looking there.
  const moveWorkItem = useCallback(
    async (item: PlaneMobileWorkItem, stateId: string): Promise<void> => {
      if (stateId === item.state.id) {
        return
      }
      const previousStateId = item.state.id
      setActiveStateId(stateId)
      const kept = await submitMove(item, stateId)
      if (!kept) {
        setActiveStateId((current) => (current === stateId ? previousStateId : current))
      }
    },
    [submitMove]
  )

  const creation = usePlaneBoardCreate({
    client,
    projectId,
    workspaceId,
    stateId: activeColumn?.stateId ?? null,
    items: loaded.items,
    reload
  })

  return {
    status,
    error,
    refreshing,
    projects: loaded.projects,
    projectId,
    projectName,
    columns,
    activeColumn,
    activeStateId: activeColumn?.stateId ?? null,
    emptyState,
    canCreate: isPlaneBoardWritableByHost(capabilities),
    canEdit: isPlaneBoardWritableByHost(capabilities),
    canAssign,
    canComment: isPlaneBoardWritableByHost(capabilities),
    members: members.members,
    membersStatus: members.status,
    loadMembers: useCallback(() => {
      if (canAssign) {
        members.load()
      }
    }, [canAssign, members.load]),
    ...editControls,
    ...moveControls,
    ...commentControls,
    ...creation,
    selectProject: useCallback(
      (next: string) => {
        setProjectId(next)
        setActiveStateId(null)
        resetMoves()
        resetEdits()
        resetComments()
      },
      [resetComments, resetEdits, resetMoves]
    ),
    selectColumn: useCallback((stateId: string) => setActiveStateId(stateId), []),
    refresh: useCallback(() => void reload(), [reload]),
    moveWorkItem
  }
}

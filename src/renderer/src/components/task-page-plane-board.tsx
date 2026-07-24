import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { SortableContext, arrayMove, horizontalListSortingStrategy } from '@dnd-kit/sortable'
import { toast } from 'sonner'

import { useAppStore } from '../store'
import { translate } from '@/i18n/i18n'
import {
  planeCreateState,
  planeListStates,
  planeUpdateState,
  planeUpdateWorkItem,
  type RuntimePlaneSettings
} from '@/runtime/runtime-plane-client'
import { PlaneBoardAddColumn } from './plane-board-add-column'
import { PlaneBoardCard } from './plane-board-card'
import { PlaneBoardColumnView } from './plane-board-column'
import { PlaneBoardFloatingMinimap } from './plane-board-floating-minimap'
import { PlaneBoardMinimap } from './plane-board-minimap'
import {
  applyPlaneBoardStateOverrides,
  orderPlaneBoardColumns,
  parsePlaneBoardColumnDroppableId,
  planPlaneBoardDrop,
  planeBoardStatesById,
  readPlaneBoardDragStateId,
  readPlaneBoardDragType,
  reconcilePlaneBoardOverrides,
  resolvePlaneBoardColumns,
  withPlaneBoardStateOverride,
  withoutPlaneBoardStateOverride,
  type PlaneBoardStateOverrides
} from './plane-board-drag'
import type { PlaneState, PlaneStateGroup, PlaneWorkItem } from '../../../shared/plane-types'

type TaskPagePlaneBoardProps = {
  items: PlaneWorkItem[]
  projectId: string
  workspaceId: string | null
  providerSettings: RuntimePlaneSettings
  selectedItemId: string | null
  getStateTone: (stateGroup: string) => string
  onOpenItem: (item: PlaneWorkItem) => void
  /** Saved per-project column order (ordered stateIds); unknown states append by sequence. */
  savedColumnOrder: string[] | undefined
  /** Persist a new column order for this project. */
  onReorderColumns: (stateIds: string[]) => void
}

export function TaskPagePlaneBoard({
  items,
  projectId,
  workspaceId,
  providerSettings,
  selectedItemId,
  getStateTone,
  onOpenItem,
  savedColumnOrder,
  onReorderColumns
}: TaskPagePlaneBoardProps): React.JSX.Element {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const patchPlaneWorkItem = useAppStore((s) => s.patchPlaneWorkItem)
  const [projectStates, setProjectStates] = useState<PlaneState[]>([])
  const [overrides, setOverrides] = useState<PlaneBoardStateOverrides>({})
  const [activeWorkItemId, setActiveWorkItemId] = useState<string | null>(null)

  // Why: a distance constraint lets a plain click through to onOpenItem; only
  // real pointer movement past the threshold begins a drag (mouse-friendly).
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  // Monotonic token so a slow refetch from a previous project can never clobber
  // the current project's states after a rapid switch.
  const fetchTokenRef = useRef(0)

  // Lifted so column rename/create can re-run it after a successful mutation.
  const refreshStates = useCallback(async (): Promise<void> => {
    const token = ++fetchTokenRef.current
    try {
      const states = await planeListStates(providerSettings, projectId, workspaceId)
      if (fetchTokenRef.current === token) {
        setProjectStates(states)
      }
    } catch {
      // Keep the current columns rendered; a later refresh retries.
    }
  }, [providerSettings, projectId, workspaceId])

  // Load the project's full state list so empty columns render, ordered by
  // sequence. Falls back to item-derived states inside resolvePlaneBoardColumns.
  useEffect(() => {
    setProjectStates([])
    void refreshStates()
  }, [refreshStates])

  const handleRenameColumn = useCallback(
    (stateId: string, name: string): void => {
      const previous = projectStates
      // Optimistically relabel; revert on failure.
      setProjectStates((states) =>
        states.map((state) => (state.id === stateId ? { ...state, name } : state))
      )
      void planeUpdateState(providerSettings, { projectId, stateId, name }, workspaceId)
        .then((result) => {
          if (!result.ok) {
            throw new Error(result.error)
          }
          void refreshStates()
        })
        .catch((error: unknown) => {
          setProjectStates(previous)
          toast.error(
            error instanceof Error
              ? error.message
              : translate(
                  'auto.components.task-page-plane-board.renameFailed',
                  'Failed to rename column.'
                )
          )
        })
    },
    [projectStates, providerSettings, projectId, workspaceId, refreshStates]
  )

  const handleCreateColumn = useCallback(
    async (name: string, group: PlaneStateGroup): Promise<boolean> => {
      const result = await planeCreateState(
        providerSettings,
        { projectId, name, group },
        workspaceId
      )
      if (!result.ok) {
        toast.error(
          result.error ||
            translate(
              'auto.components.task-page-plane-board.createFailed',
              'Failed to create column.'
            )
        )
        return false
      }
      await refreshStates()
      return true
    },
    [providerSettings, projectId, workspaceId, refreshStates]
  )

  // Drop overrides that an incoming refresh has already reconciled.
  useEffect(() => {
    setOverrides((current) => reconcilePlaneBoardOverrides(current, items))
  }, [items])

  const columns = useMemo(() => {
    const statesById = planeBoardStatesById(resolvePlaneBoardColumns(items, projectStates))
    const displayed = applyPlaneBoardStateOverrides(items, overrides, statesById)
    const resolved = resolvePlaneBoardColumns(displayed, projectStates)
    return orderPlaneBoardColumns(resolved, savedColumnOrder)
  }, [items, projectStates, overrides, savedColumnOrder])

  const columnStateIds = useMemo(() => columns.map((column) => column.stateId), [columns])

  const activeItem = useMemo(
    () =>
      activeWorkItemId
        ? (columns.flatMap((column) => column.items).find((item) => item.id === activeWorkItemId) ??
          null)
        : null,
    [activeWorkItemId, columns]
  )

  const handleDragStart = (event: DragStartEvent): void => {
    // Column drags have no card overlay; only track the active card id.
    if (readPlaneBoardDragType(event.active.data.current) === 'column') {
      return
    }
    setActiveWorkItemId(String(event.active.id))
  }

  const handleColumnDragEnd = useCallback(
    (event: DragEndEvent): void => {
      const activeStateId = String(event.active.id)
      const overData = event.over?.data.current
      const overStateId =
        readPlaneBoardDragStateId(overData) ??
        (event.over ? parsePlaneBoardColumnDroppableId(String(event.over.id)) : null)
      if (!overStateId || overStateId === activeStateId) {
        return
      }
      const from = columnStateIds.indexOf(activeStateId)
      const to = columnStateIds.indexOf(overStateId)
      if (from < 0 || to < 0 || from === to) {
        return
      }
      onReorderColumns(arrayMove(columnStateIds, from, to))
    },
    [columnStateIds, onReorderColumns]
  )

  const handleDragEnd = (event: DragEndEvent): void => {
    setActiveWorkItemId(null)
    if (readPlaneBoardDragType(event.active.data.current) === 'column') {
      handleColumnDragEnd(event)
      return
    }
    // Both the card droppable and the column sortable carry stateId; prefer that
    // so the target resolves regardless of which droppable dnd-kit reports.
    const overData = event.over?.data.current
    const overId = event.over ? String(event.over.id) : null
    const targetStateId =
      readPlaneBoardDragStateId(overData) ??
      (overId ? parsePlaneBoardColumnDroppableId(overId) : null)
    const plan = planPlaneBoardDrop({
      columns,
      activeWorkItemId: String(event.active.id),
      targetStateId
    })
    if (!plan) {
      return
    }

    const { workItem, targetState, update } = plan
    // Optimistically move the card, then reuse the detail state-picker's write
    // path (planeUpdateWorkItem + patchPlaneWorkItem). Revert on failure.
    setOverrides((current) => withPlaneBoardStateOverride(current, workItem.id, update.stateId))
    patchPlaneWorkItem(workItem.id, { state: targetState })

    void planeUpdateWorkItem(
      providerSettings,
      update.projectId,
      update.workItemId,
      { stateId: update.stateId },
      update.workspaceId
    )
      .then((result) => {
        if (!result.ok) {
          throw new Error(result.error)
        }
      })
      .catch((error: unknown) => {
        setOverrides((current) => withoutPlaneBoardStateOverride(current, workItem.id))
        patchPlaneWorkItem(workItem.id, { state: workItem.state })
        toast.error(
          error instanceof Error
            ? error.message
            : translate(
                'auto.components.task-page-plane-board.updateFailed',
                'Failed to move work item.'
              )
        )
      })
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveWorkItemId(null)}
    >
      <div className="flex h-full min-h-0 flex-col">
        <PlaneBoardMinimap
          columns={columns}
          getStateTone={getStateTone}
          scrollContainerRef={scrollContainerRef}
        />
        <div className="relative min-h-0 flex-1">
          <div
            ref={scrollContainerRef}
            className="flex h-full min-h-0 gap-3 overflow-x-auto scrollbar-sleek p-3"
          >
            <SortableContext items={columnStateIds} strategy={horizontalListSortingStrategy}>
              {columns.map((column) => (
                <PlaneBoardColumnView
                  key={column.stateId}
                  column={column}
                  getStateTone={getStateTone}
                  selectedItemId={selectedItemId}
                  onOpenItem={onOpenItem}
                  onRenameColumn={handleRenameColumn}
                />
              ))}
            </SortableContext>
            <PlaneBoardAddColumn onCreate={handleCreateColumn} />
          </div>
          <PlaneBoardFloatingMinimap
            columnCount={columns.length}
            scrollContainerRef={scrollContainerRef}
          />
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {activeItem ? (
          <div className="w-72">
            <PlaneBoardCard item={activeItem} selected={false} onOpenItem={() => {}} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

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
import { useConfirmationDialog } from './confirmation-dialog'
import {
  planeCreateWorkItem,
  planeDeleteState,
  planeListStates,
  planeUpdateState,
  planeUpdateWorkItem,
  type RuntimePlaneSettings
} from '@/runtime/runtime-plane-client'
import { confirmAndDeletePlaneWorkItem } from './plane-board-card-delete'
import { getPlaneMutationErrorMessage } from './plane-mutation-error-message'
import { createPlaneBoardColumnAtPosition, PlaneBoardAddColumn } from './plane-board-add-column'
import { PlaneBoardCard } from './plane-board-card'
import { PlaneBoardColumnView } from './plane-board-column'
import { PlaneBoardFloatingMinimap } from './plane-board-floating-minimap'
import { PlaneBoardMinimap } from './plane-board-minimap'
import {
  applyPlaneBoardStateOverrides,
  parsePlaneBoardColumnDroppableId,
  planPlaneBoardColumnReorder,
  planPlaneBoardDrop,
  planeBoardStatesById,
  readPlaneBoardDragStateId,
  readPlaneBoardDragType,
  reconcilePlaneBoardOverrides,
  resolvePlaneBoardColumns,
  withPlaneBoardStateOverride,
  withoutPlaneBoardStateOverride,
  type PlaneBoardSequenceUpdate,
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
  /** Reports the id of a card the inline composer just created, so the caller can
   *  open its sheet into the description editor. */
  onItemCreated?: (itemId: string) => void
}

function showPlaneMutationError(error: unknown, fallback: string): void {
  console.error('[plane-board] mutation failed:', error)
  toast.error(getPlaneMutationErrorMessage(error, fallback))
}

export function TaskPagePlaneBoard({
  items,
  projectId,
  workspaceId,
  providerSettings,
  selectedItemId,
  getStateTone,
  onOpenItem,
  onItemCreated
}: TaskPagePlaneBoardProps): React.JSX.Element {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const confirm = useConfirmationDialog()
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
          showPlaneMutationError(
            error,
            translate(
              'auto.components.task-page-plane-board.renameFailed',
              'Failed to rename column.'
            )
          )
        })
    },
    [projectStates, providerSettings, projectId, workspaceId, refreshStates]
  )

  const handleCreateItem = useCallback(
    async (stateId: string, title: string): Promise<boolean> => {
      const result = await planeCreateWorkItem(
        providerSettings,
        { projectId, title, stateId },
        workspaceId
      )
      if (!result.ok) {
        showPlaneMutationError(
          result.error,
          translate(
            'auto.components.task-page-plane-board.createItemFailed',
            'Failed to create work item.'
          )
        )
        return false
      }
      // Why only report the id: opening the detail needs the REAL work item (the
      // page route resolves project/state/labels from it), and a synthetic stand-in
      // silently failed to navigate. The caller opens it once the refetch lands.
      onItemCreated?.(result.id)
      return true
    },
    [providerSettings, projectId, workspaceId, onItemCreated]
  )

  // Drop overrides that an incoming refresh has already reconciled.
  useEffect(() => {
    setOverrides((current) => reconcilePlaneBoardOverrides(current, items))
  }, [items])

  // Plane's `sequence` is the single source of truth for column order;
  // resolvePlaneBoardColumns already sorts by it, so no local re-order layer.
  const columns = useMemo(() => {
    const statesById = planeBoardStatesById(resolvePlaneBoardColumns(items, projectStates))
    const displayed = applyPlaneBoardStateOverrides(items, overrides, statesById)
    return resolvePlaneBoardColumns(displayed, projectStates)
  }, [items, projectStates, overrides])

  const columnStateIds = useMemo(() => columns.map((column) => column.stateId), [columns])

  const handleCreateColumn = useCallback(
    async (insertionIndex: number, name: string, group: PlaneStateGroup): Promise<boolean> => {
      const result = await createPlaneBoardColumnAtPosition({
        providerSettings,
        projectId,
        workspaceId,
        name,
        group,
        insertionIndex,
        states: columns.map((column) => column.state),
        showError: showPlaneMutationError
      })
      if (result) {
        await refreshStates()
      }
      return result
    },
    [providerSettings, projectId, workspaceId, columns, refreshStates]
  )

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

  // Persist a reorder to Plane's authoritative `sequence`, one PATCH per changed
  // column (in order). Optimistically applied already; revert + toast on failure.
  const persistColumnReorder = useCallback(
    async (updates: PlaneBoardSequenceUpdate[], previousStates: PlaneState[]): Promise<void> => {
      try {
        for (const update of updates) {
          const result = await planeUpdateState(
            providerSettings,
            { projectId, stateId: update.stateId, sequence: update.sequence },
            workspaceId
          )
          if (!result.ok) {
            throw new Error(result.error)
          }
        }
        await refreshStates()
      } catch (error) {
        setProjectStates(previousStates)
        showPlaneMutationError(
          error,
          translate(
            'auto.components.task-page-plane-board.reorderFailed',
            'Failed to reorder columns.'
          )
        )
      }
    },
    [providerSettings, projectId, workspaceId, refreshStates]
  )

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
      const orderedStateIds = arrayMove(columnStateIds, from, to)
      const currentSequenceByStateId = new Map(
        projectStates.map((state) => [state.id, state.sequence] as const)
      )
      const updates = planPlaneBoardColumnReorder(orderedStateIds, currentSequenceByStateId)
      if (updates.length === 0) {
        return
      }
      const previousStates = projectStates
      const nextSequenceByStateId = new Map(
        updates.map((update) => [update.stateId, update.sequence])
      )
      // Optimistically apply the new sequences so columns re-sort instantly.
      setProjectStates((states) =>
        states.map((state) => {
          const sequence = nextSequenceByStateId.get(state.id)
          return sequence === undefined ? state : { ...state, sequence }
        })
      )
      void persistColumnReorder(updates, previousStates)
    },
    [columnStateIds, projectStates, persistColumnReorder]
  )

  const handleDeleteColumn = useCallback(
    async (stateId: string, name: string): Promise<void> => {
      const confirmed = await confirm({
        title: translate(
          'auto.components.task-page-plane-board.deleteConfirmTitle',
          'Delete column «{{value0}}»?',
          { value0: name }
        ),
        description: translate(
          'auto.components.task-page-plane-board.deleteConfirmDescription',
          'Work items may need reassigning.'
        ),
        confirmLabel: translate(
          'auto.components.task-page-plane-board.deleteConfirmAction',
          'Delete'
        ),
        confirmVariant: 'destructive'
      })
      if (!confirmed) {
        return
      }
      const result = await planeDeleteState(providerSettings, { projectId, stateId }, workspaceId)
      if (!result.ok) {
        showPlaneMutationError(
          result.error,
          translate(
            'auto.components.task-page-plane-board.deleteFailed',
            'Failed to delete column.'
          )
        )
        return
      }
      await refreshStates()
    },
    [confirm, providerSettings, projectId, workspaceId, refreshStates]
  )

  const handleDeleteItem = useCallback(
    (item: PlaneWorkItem): void =>
      void confirmAndDeletePlaneWorkItem({
        confirm,
        item,
        projectId,
        workspaceId,
        providerSettings
      }),
    [confirm, providerSettings, projectId, workspaceId]
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
        showPlaneMutationError(
          error,
          translate(
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
              {columns.map((column, index) => (
                <React.Fragment key={column.stateId}>
                  <PlaneBoardAddColumn
                    compact
                    insertionIndex={index}
                    onCreate={handleCreateColumn}
                  />
                  <PlaneBoardColumnView
                    column={column}
                    getStateTone={getStateTone}
                    selectedItemId={selectedItemId}
                    onOpenItem={onOpenItem}
                    onRenameColumn={handleRenameColumn}
                    onDeleteColumn={handleDeleteColumn}
                    onCreateItem={handleCreateItem}
                    onDeleteItem={handleDeleteItem}
                  />
                </React.Fragment>
              ))}
            </SortableContext>
            <PlaneBoardAddColumn insertionIndex={columns.length} onCreate={handleCreateColumn} />
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

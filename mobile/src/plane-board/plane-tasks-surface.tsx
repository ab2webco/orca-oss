import { useCallback, useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import type { PlaneWorkItemFilter } from '../../../src/shared/plane-types'
import type { RpcClient } from '../transport/rpc-client'
import type { ProviderTaskOrderBy } from '../tasks/linear-mobile-issue-grouping'
import type {
  PlaneMobileProject,
  PlaneMobileState,
  PlaneMobileWorkItem
} from '../tasks/plane-mobile-work-item-read'
import { fetchPlaneStates } from '../tasks/plane-mobile-task-source'
import type { PlaneTaskDisplayProperty } from '../tasks/provider-task-display-properties'
import type { PlaneTaskGroupBy } from '../tasks/provider-task-view-options'
import { resolveLivePlaneWorkItem, resolvePlaneBoardScope } from './plane-board-scope'
import { PlaneCreateSheet } from './plane-create-sheet'
import { createPlaneWorkItemFromHeader, stubPlaneWorkItem } from './plane-header-create'
import { PlaneTaskBoard } from './plane-task-board'
import { PlaneWorkItemDetailSheet } from './plane-work-item-detail-sheet'
import type { PlaneViewMode } from './plane-work-item-view'
import { usePlaneBoard, type PlaneBoardRows } from './use-plane-board'

type Props = {
  client: RpcClient | null
  capabilities: readonly string[] | undefined
  /** False until the Tasks screen shows Plane on a host that can serve it. */
  enabled: boolean
  planeConnected: boolean
  viewMode: PlaneViewMode
  /** Owned by the Tasks screen so the bar's chips and the board agree, and so the
   *  choice survives the switch between the two views (ORCA-418). */
  groupBy: PlaneTaskGroupBy
  orderBy: ProviderTaskOrderBy
  /** Owned by the Tasks screen too, so the bar's sheet and both views agree. */
  displayProperties: ReadonlySet<PlaneTaskDisplayProperty>
  workspaceId: string | null
  projectId: string | null
  projects: readonly PlaneMobileProject[]
  filter: PlaneWorkItemFilter
  query: string
  /** The Plane rows the Tasks screen already read; the board's columns are these,
   *  reprojected. Passing them is what makes the switch to board instant (ORCA-417). */
  workItems: readonly PlaneMobileWorkItem[]
  itemsLoading: boolean
  itemsRefreshing: boolean
  /** Re-reads those rows and resolves with them, so a board write can reconcile. */
  onRefreshItems: () => Promise<PlaneMobileWorkItem[] | null>
  /** The card whose detail is open, tapped in either view. */
  detailItem: PlaneMobileWorkItem | null
  onOpenCard: (item: PlaneMobileWorkItem) => void
  onCloseDetail: () => void
  onCopyLink: (item: PlaneMobileWorkItem) => void
  /** Whether the open card's link was just copied; the parent owns the copied-key bookkeeping. */
  copied: boolean
  onPickProject: () => void
  onClearFilter: () => void
  bottomInset: number
  /** The header `+` sheet (ORCA-463); opened by the Tasks screen, closed here or by it. */
  createOpen: boolean
  onCloseCreate: () => void
  projectLabel: string
  /** The project's first state: where a header-created card lands when no board column is shown. */
  defaultState: PlaneMobileState | null
}

/** Everything Plane-specific the Tasks screen mounts besides its own list rows:
 *  the board view when that is the chosen view, and the one work item detail both
 *  views open. The list rows stay in the Tasks screen; this is what they open into. */
export function PlaneTasksSurface({
  client,
  capabilities,
  enabled,
  planeConnected,
  viewMode,
  groupBy,
  orderBy,
  displayProperties,
  workspaceId,
  projectId,
  projects,
  filter,
  query,
  workItems,
  itemsLoading,
  itemsRefreshing,
  onRefreshItems,
  detailItem,
  onOpenCard,
  onCloseDetail,
  onCopyLink,
  copied,
  onPickProject,
  onClearFilter,
  bottomInset,
  createOpen,
  onCloseCreate,
  projectLabel,
  defaultState
}: Props) {
  const openItem = enabled ? detailItem : null
  const rows = useMemo<PlaneBoardRows>(
    () => ({
      items: workItems,
      loading: itemsLoading,
      refreshing: itemsRefreshing,
      refresh: onRefreshItems
    }),
    [itemsLoading, itemsRefreshing, onRefreshItems, workItems]
  )
  const board = usePlaneBoard(
    client,
    capabilities,
    resolvePlaneBoardScope({
      enabled,
      planeConnected,
      viewMode,
      workspaceId,
      projectId,
      projects,
      filter,
      query,
      detailItem: openItem
    }),
    rows
  )
  // Resolved live so an optimistic edit shows in the sheet as well as on the card.
  const live = resolveLivePlaneWorkItem(board.columns, openItem)

  // Await the move before closing: closing re-reads the Tasks list, and in list mode the
  // row comes from that list, not board.columns. Closing first raced the re-read ahead of
  // the write, so a success left the row stale and a failure had nowhere to show. Keep the
  // sheet open on failure — its move-error row is the only one mounted in list mode.
  const moveOpenCard = useCallback(
    (stateId: string) => {
      const item = live
      if (!item) {
        return
      }
      void board.moveWorkItem(item, stateId).then((kept) => {
        // Close on success either way. On failure, board mode keeps the sheet closed because
        // PlaneTaskBoard shows the move error; list mode keeps it open because the sheet is
        // the only place that error can appear there (blocker 1).
        if (kept || viewMode === 'board') {
          onCloseDetail()
        }
      })
    },
    [board, live, onCloseDetail, viewMode]
  )

  const copyOpenCard = useCallback(() => {
    if (live) {
      onCopyLink(live)
    }
  }, [live, onCopyLink])

  // The board's first column wins over the project's first state: it is the column on screen.
  const firstColumn = board.columns[0]
  const landingState = useMemo(
    () =>
      firstColumn
        ? { id: firstColumn.stateId, name: firstColumn.name, group: firstColumn.group }
        : defaultState,
    [defaultState, firstColumn]
  )
  const createFromHeader = useCallback(
    async (title: string) => {
      if (!client) {
        return { ok: false as const, error: 'Not connected to the host' }
      }
      const knownIds = new Set(workItems.map((item) => item.id))
      // Why: the screen empties planeStates on a project change and refills it only after its
      // own read, so a + right after picking a project would otherwise send an empty stateId.
      const landing =
        landingState ??
        (projectId ? await fetchFirstPlaneState(client, projectId, workspaceId) : null)
      const result = await createPlaneWorkItemFromHeader(client, {
        projectId,
        workspaceId,
        defaultStateId: landing?.id ?? null,
        title
      })
      if (!result.ok) {
        if (!result.deliveryUnknown) {
          return result
        }
        // Same rule as the composer: a retry after a timeout would make the card twice.
        const landed = (await onRefreshItems())?.find(
          (item) => !knownIds.has(item.id) && item.state.id === landing?.id && item.title === title
        )
        if (!landed) {
          return result
        }
        onCloseCreate()
        onOpenCard(landed)
        return { ok: true as const }
      }
      onCloseCreate()
      // The create reply carries no card and the header has no column to show it in, so
      // open the detail: the fresh row when the re-read has it, else a stub until it does.
      const fresh = await onRefreshItems()
      const created = fresh?.find((item) => item.id === result.id)
      onOpenCard(
        created ??
          stubPlaneWorkItem({
            id: result.id,
            identifier: result.identifier,
            title,
            project: projects.find((project) => project.id === projectId) ?? {
              id: projectId ?? '',
              identifier: '',
              name: ''
            },
            state: landing ?? { id: '', name: '', group: '' },
            workspaceId
          })
      )
      return { ok: true as const }
    },
    [
      client,
      landingState,
      onCloseCreate,
      onOpenCard,
      onRefreshItems,
      projectId,
      projects,
      workItems,
      workspaceId
    ]
  )
  const pickProjectFromCreate = useCallback(() => {
    onCloseCreate()
    onPickProject()
  }, [onCloseCreate, onPickProject])

  return (
    <>
      {enabled && viewMode === 'board' ? (
        <View style={styles.board}>
          <PlaneTaskBoard
            board={board}
            groupBy={groupBy}
            orderBy={orderBy}
            displayProperties={displayProperties}
            sheetOpen={live !== null}
            onOpenCard={onOpenCard}
            onPickProject={onPickProject}
            onClearFilter={onClearFilter}
            bottomInset={bottomInset}
          />
        </View>
      ) : null}
      <PlaneWorkItemDetailSheet
        item={live}
        board={board}
        planeConnected={planeConnected}
        onMove={moveOpenCard}
        onClose={onCloseDetail}
        onCopyLink={live ? () => copyOpenCard() : undefined}
        copied={copied}
      />
      <PlaneCreateSheet
        visible={enabled && createOpen}
        projectLabel={projectLabel}
        onPickProject={pickProjectFromCreate}
        onClose={onCloseCreate}
        onCreate={createFromHeader}
      />
    </>
  )
}

/** Null when the read fails or the project has no states: the create then answers with
 *  its own missing-column text. */
async function fetchFirstPlaneState(
  client: RpcClient,
  projectId: string,
  workspaceId: string | null
): Promise<PlaneMobileState | null> {
  try {
    return (await fetchPlaneStates(client, projectId, workspaceId))[0] ?? null
  } catch {
    return null
  }
}

const styles = StyleSheet.create({
  board: { flex: 1 }
})

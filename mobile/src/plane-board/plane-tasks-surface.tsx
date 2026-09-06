import { useCallback, useState } from 'react'
import { StyleSheet, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native'
import type { PlaneWorkItemFilter } from '../../../src/shared/plane-types'
import type { RpcClient } from '../transport/rpc-client'
import type { ProviderTaskOrderBy } from '../tasks/linear-mobile-issue-grouping'
import type { PlaneMobileProject, PlaneMobileWorkItem } from '../tasks/plane-mobile-work-item-read'
import type { PlaneTaskGroupBy } from '../tasks/provider-task-view-options'
import { resolveLivePlaneWorkItem, resolvePlaneBoardScope } from './plane-board-scope'
import { PlaneBoardViewMenu } from './plane-board-view-menu'
import { PlaneTaskBoard } from './plane-task-board'
import { PlaneWorkItemDetailSheet } from './plane-work-item-detail-sheet'
import type { PlaneViewMode } from './plane-work-item-view'
import { usePlaneBoard } from './use-plane-board'

type Props = {
  client: RpcClient | null
  capabilities: readonly string[] | undefined
  /** False until the Tasks screen shows Plane on a host that can serve it. */
  enabled: boolean
  planeConnected: boolean
  viewMode: PlaneViewMode
  workspaceId: string | null
  projectId: string | null
  projects: readonly PlaneMobileProject[]
  filter: PlaneWorkItemFilter
  query: string
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
  /** The Tasks screen's segment-row chip look, so the board's menu matches the row above it. */
  menuButtonStyle: StyleProp<ViewStyle>
  menuTextStyle: StyleProp<TextStyle>
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
  workspaceId,
  projectId,
  projects,
  filter,
  query,
  detailItem,
  onOpenCard,
  onCloseDetail,
  onCopyLink,
  copied,
  onPickProject,
  onClearFilter,
  bottomInset,
  menuButtonStyle,
  menuTextStyle
}: Props) {
  const openItem = enabled ? detailItem : null
  const [groupBy, setGroupBy] = useState<PlaneTaskGroupBy>('none')
  const [orderBy, setOrderBy] = useState<ProviderTaskOrderBy>('priority')
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
    })
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

  return (
    <>
      {enabled && viewMode === 'board' ? (
        <View style={styles.board}>
          <PlaneBoardViewMenu
            groupBy={groupBy}
            orderBy={orderBy}
            onChangeGroupBy={setGroupBy}
            onChangeOrderBy={setOrderBy}
            buttonStyle={menuButtonStyle}
            textStyle={menuTextStyle}
          />
          <PlaneTaskBoard
            board={board}
            groupBy={groupBy}
            orderBy={orderBy}
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
        onMove={moveOpenCard}
        onClose={onCloseDetail}
        onCopyLink={live ? () => copyOpenCard() : undefined}
        copied={copied}
      />
    </>
  )
}

const styles = StyleSheet.create({
  board: { flex: 1 }
})

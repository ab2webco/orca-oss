import { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { Plus } from 'lucide-react-native'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import type { PlaneMobileWorkItem } from '../tasks/plane-mobile-work-item-read'
import { PLANE_PRIORITY_LABELS } from '../tasks/plane-priority-label'
import { ProviderTaskBoard, type ProviderTaskBoardSection } from '../tasks/provider-task-board'
import { formatUpdatedAt } from '../tasks/task-updated-at-time'
import type { PlaneBoardColumn } from './plane-board-columns'
import { PlaneBoardCreateDrawer } from './plane-board-create-drawer'
import { PlaneBoardWriteErrorRow } from './plane-board-write-error-row'
import type { PlaneBoard } from './use-plane-board'

/** A state's colour when Plane sent none: its group is what the dot can still say. */
function planeStateGroupColor(group: string): string {
  if (group === 'started') {
    return colors.statusAmber
  }
  if (group === 'completed') {
    return colors.statusGreen
  }
  if (group === 'cancelled') {
    return colors.statusRed
  }
  return colors.textMuted
}

/** Columns are already in the project's state order with sorted cards; the shell just draws them. */
function planeBoardSections(
  columns: readonly PlaneBoardColumn[]
): ProviderTaskBoardSection<PlaneMobileWorkItem>[] {
  return columns.map((column) => ({
    key: column.stateId,
    label: column.name,
    color: column.color ?? planeStateGroupColor(column.group),
    items: column.items
  }))
}

// The in-flight word goes first: the shell clamps the subtitle to two lines, and the
// facts after it are what may be cut, never the signal that a write is still pending.
function planeCardSubtitle(item: PlaneMobileWorkItem, board: PlaneBoard): string {
  const parts: string[] = []
  if (board.movingWorkItemIds.has(item.id)) {
    parts.push('Moving…')
  } else if (board.editingWorkItemIds.has(item.id)) {
    parts.push('Updating…')
  }
  parts.push(item.identifier, formatUpdatedAt(item.updatedAt))
  if (item.priority !== 'none') {
    parts.push(PLANE_PRIORITY_LABELS[item.priority])
  }
  parts.push(...item.assignees.map((assignee) => assignee.displayName))
  return parts.filter(Boolean).join(' · ')
}

type Props = {
  board: PlaneBoard
  /** While a card's sheet is open it shows that card's write error; the board stays quiet. */
  sheetOpen: boolean
  onOpenCard: (item: PlaneMobileWorkItem) => void
  onPickProject: () => void
  onClearFilter: () => void
  bottomInset: number
}

/** The board view of the Tasks screen: Plane's columns through the provider-neutral shell. */
export function PlaneTaskBoard({
  board,
  sheetOpen,
  onOpenCard,
  onPickProject,
  onClearFilter,
  bottomInset
}: Props) {
  const [showCreate, setShowCreate] = useState(false)

  const onEmptyAction = useCallback(() => {
    const action = board.emptyState?.action
    if (action === 'pick-project') {
      onPickProject()
    } else if (action === 'clear-filter') {
      onClearFilter()
    } else if (action === 'refresh') {
      board.refresh()
    }
  }, [board, onClearFilter, onPickProject])

  const closeCreate = useCallback(() => {
    setShowCreate(false)
    board.dismissCreateError()
  }, [board])

  if (board.status === 'loading') {
    return (
      <View style={styles.placeholder}>
        <ActivityIndicator color={colors.textSecondary} />
        <Text style={styles.placeholderText}>Loading board…</Text>
      </View>
    )
  }
  if (board.error) {
    return (
      <View style={styles.placeholder}>
        <Text style={styles.errorText}>{board.error}</Text>
        <Pressable accessibilityRole="button" style={styles.emptyButton} onPress={board.refresh}>
          <Text style={styles.emptyButtonText}>Retry</Text>
        </Pressable>
      </View>
    )
  }
  // Without columns there is no board to draw; with them, the cause sits above the empty
  // columns so a card can still be added. An empty column is visible as such on the shell.
  const emptyState =
    board.emptyState && board.emptyState.kind !== 'column-empty' ? board.emptyState : null
  const notice = emptyState ? (
    <View style={styles.placeholder}>
      <Text style={styles.emptyTitle}>{emptyState.title}</Text>
      <Text style={styles.emptyBody}>{emptyState.body}</Text>
      {emptyState.actionLabel ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={emptyState.actionLabel}
          style={styles.emptyButton}
          onPress={onEmptyAction}
        >
          <Text style={styles.emptyButtonText}>{emptyState.actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  ) : null
  if (board.columns.length === 0) {
    return notice
  }

  // A failed card of another project keeps its error for when that board is back;
  // this board shows only what belongs to its own columns.
  const onBoard = (workItemId: string | null): boolean =>
    workItemId !== null &&
    board.columns.some((column) => column.items.some((item) => item.id === workItemId))

  return (
    <View style={styles.view}>
      {notice}
      <ProviderTaskBoard
        sections={planeBoardSections(board.columns)}
        bottomInset={bottomInset}
        getItemKey={(item) => item.id}
        getTitle={(item) => item.title || 'Untitled work item'}
        getSubtitle={(item) => planeCardSubtitle(item, board)}
        getStatus={(item) => ({
          label: item.state.name || item.state.group,
          color: item.state.color || planeStateGroupColor(item.state.group),
          accessibilityLabel: `Move from ${item.state.name || item.state.group}`
        })}
        onPressItem={onOpenCard}
        // The detail owns "Move to"; the pill is the shortcut into it.
        onPressStatus={onOpenCard}
        writeErrorSlot={
          <>
            {board.moveError && onBoard(board.moveErrorWorkItemId) ? (
              <Pressable style={styles.moveError} onPress={board.dismissMoveError}>
                <Text style={styles.moveErrorText}>
                  Could not move the card — {board.moveError}
                </Text>
              </Pressable>
            ) : null}
            {board.editError && !sheetOpen && onBoard(board.editErrorWorkItemId) ? (
              <PlaneBoardWriteErrorRow
                message={`Could not update the card — ${board.editError}`}
                onRetry={() => void board.retryEdit()}
                onDismiss={board.dismissEditError}
              />
            ) : null}
          </>
        }
        createDrawerSlot={
          board.canCreate ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add card"
                style={styles.addButton}
                disabled={board.activeColumn === null}
                onPress={() => setShowCreate(true)}
              >
                <Plus
                  size={14}
                  color={board.activeColumn ? colors.textPrimary : colors.textMuted}
                />
                <Text style={styles.addText}>Add card</Text>
              </Pressable>
              <PlaneBoardCreateDrawer
                visible={showCreate}
                columnName={board.activeColumn?.name ?? null}
                pending={board.create.pending}
                error={board.create.error}
                onSubmit={board.createCard}
                onClose={closeCreate}
              />
            </>
          ) : undefined
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  view: { flex: 1 },
  moveError: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.row,
    backgroundColor: colors.bgPanel
  },
  moveErrorText: { fontSize: typography.metaSize, color: colors.statusRed },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm
  },
  placeholderText: { fontSize: typography.bodySize, color: colors.textSecondary },
  errorText: { fontSize: typography.bodySize, color: colors.statusRed, textAlign: 'center' },
  emptyTitle: {
    fontSize: typography.bodySize,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center'
  },
  emptyBody: { fontSize: typography.metaSize, color: colors.textMuted, textAlign: 'center' },
  emptyButton: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.button,
    backgroundColor: colors.bgRaised
  },
  emptyButtonText: { fontSize: typography.bodySize, color: colors.textPrimary },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.button,
    backgroundColor: colors.bgPanel
  },
  addText: { fontSize: typography.metaSize, color: colors.textSecondary }
})

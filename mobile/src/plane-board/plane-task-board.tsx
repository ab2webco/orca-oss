import { useCallback } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import type { ProviderTaskOrderBy } from '../tasks/linear-mobile-issue-grouping'
import type { PlaneMobileWorkItem } from '../tasks/plane-mobile-work-item-read'
import { planeWorkItemDisplayFacts } from '../tasks/plane-work-item-display-facts'
import { ProviderTaskBoard } from '../tasks/provider-task-board'
import type { PlaneTaskDisplayProperty } from '../tasks/provider-task-display-properties'
import type { PlaneTaskGroupBy } from '../tasks/provider-task-view-options'
import { PlaneBoardColumnComposer } from './plane-board-column-composer'
import {
  planeBoardColumnStateId,
  planeBoardSections,
  planeStateGroupColor
} from './plane-board-sections'
import { PlaneBoardWriteErrorRow } from './plane-board-write-error-row'
import type { PlaneBoard } from './use-plane-board'

// The in-flight word goes first: the shell clamps the subtitle to two lines, and the
// facts after it are what may be cut, never the signal that a write is still pending.
function planeCardSubtitle(
  item: PlaneMobileWorkItem,
  board: PlaneBoard,
  displayProperties: ReadonlySet<PlaneTaskDisplayProperty>
): string {
  const parts: string[] = []
  if (board.movingWorkItemIds.has(item.id)) {
    parts.push('Moving…')
  } else if (board.editingWorkItemIds.has(item.id)) {
    parts.push('Updating…')
  }
  parts.push(...planeWorkItemDisplayFacts(item, displayProperties))
  return parts.join(' · ')
}

type Props = {
  board: PlaneBoard
  groupBy: PlaneTaskGroupBy
  orderBy: ProviderTaskOrderBy
  displayProperties: ReadonlySet<PlaneTaskDisplayProperty>
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
  groupBy,
  orderBy,
  displayProperties,
  sheetOpen,
  onOpenCard,
  onPickProject,
  onClearFilter,
  bottomInset
}: Props) {
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

  if (board.status === 'loading') {
    return (
      <View style={styles.placeholder}>
        <ActivityIndicator color={colors.textSecondary} />
        <Text style={styles.placeholderText}>Loading board…</Text>
      </View>
    )
  }
  // Only when there is nothing to draw: the error is the state metadata read, and cards
  // already on screen sit in columns they derive themselves. The sheet still shows the
  // failure where it blocks something — "Move to" needs the real column list.
  if (board.error && board.columns.length === 0) {
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
        sections={planeBoardSections(board.columns, groupBy, orderBy)}
        bottomInset={bottomInset}
        getItemKey={(item) => item.id}
        getTitle={(item) => item.title || 'Untitled work item'}
        getSubtitle={(item) => planeCardSubtitle(item, board, displayProperties)}
        getStatus={(item) =>
          displayProperties.has('state')
            ? {
                label: item.state.name || item.state.group,
                color: item.state.color || planeStateGroupColor(item.state.group),
                accessibilityLabel: `Move from ${item.state.name || item.state.group}`
              }
            : null
        }
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
            {board.create.error ? (
              <PlaneBoardWriteErrorRow
                message={`Could not add the card — ${board.create.error}`}
                // The composer keeps the title for a retry; resending blind could make the card twice.
                onRetry={null}
                onDismiss={board.dismissCreateError}
              />
            ) : null}
          </>
        }
        renderColumnFooterSlot={(section) => {
          // No stateId means the column is a priority or an assignee, not a state: there is
          // nothing for Plane to create into (ORCA-422).
          const stateId = planeBoardColumnStateId(section, groupBy)
          if (!board.canCreate || stateId === null) {
            return null
          }
          return (
            <PlaneBoardColumnComposer
              columnName={section.label}
              onCreate={(title) => board.createCard(title, stateId)}
            />
          )
        }}
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
  emptyButtonText: { fontSize: typography.bodySize, color: colors.textPrimary }
})

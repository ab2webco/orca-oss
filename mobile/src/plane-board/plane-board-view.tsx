import { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native'
import { Plus } from 'lucide-react-native'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import { formatUpdatedAt } from '../tasks/task-updated-at-time'
import type { PlaneMobileWorkItem } from '../tasks/plane-mobile-work-item-read'
import { PLANE_PRIORITY_LABELS } from '../tasks/plane-priority-label'
import { PlaneBoardCreateDrawer } from './plane-board-create-drawer'
import { PlaneBoardWriteErrorRow } from './plane-board-write-error-row'
import type { PlaneBoard } from './use-plane-board'

/** What the card shows besides its title: priority when set, then who holds it. */
function cardFacts(item: PlaneMobileWorkItem): string[] {
  const facts = item.priority === 'none' ? [] : [PLANE_PRIORITY_LABELS[item.priority]]
  return facts.concat(item.assignees.map((assignee) => assignee.displayName).filter(Boolean))
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

/** The board view of the Tasks screen: one project's columns, one column's cards. */
export function PlaneBoardView({
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

  // A failed card of another project keeps its error for when that board is back;
  // this board shows only what belongs to its own columns.
  const onBoard = (workItemId: string | null): boolean =>
    workItemId !== null &&
    board.columns.some((column) => column.items.some((item) => item.id === workItemId))

  const closeCreate = useCallback(() => {
    setShowCreate(false)
    board.dismissCreateError()
  }, [board])

  return (
    <View style={styles.view}>
      {board.columns.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.columnBar}
        >
          {board.columns.map((column) => {
            const active = column.stateId === board.activeStateId
            return (
              <Pressable
                key={column.stateId}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${column.name}, ${column.items.length} cards`}
                style={[styles.columnChip, active && styles.columnChipActive]}
                onPress={() => board.selectColumn(column.stateId)}
              >
                <Text style={[styles.columnName, active && styles.columnNameActive]}>
                  {column.name}
                </Text>
                <Text style={[styles.columnCount, active && styles.columnCountActive]}>
                  {column.items.length}
                </Text>
              </Pressable>
            )
          })}
          {board.canCreate ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add card"
              style={styles.columnChip}
              disabled={board.activeColumn === null}
              onPress={() => setShowCreate(true)}
            >
              <Plus size={14} color={board.activeColumn ? colors.textPrimary : colors.textMuted} />
              <Text style={styles.columnName}>Add</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      ) : null}

      {board.moveError && onBoard(board.moveErrorWorkItemId) ? (
        <Pressable style={styles.moveError} onPress={board.dismissMoveError}>
          <Text style={styles.moveErrorText}>Could not move the card — {board.moveError}</Text>
        </Pressable>
      ) : null}
      {board.editError && !sheetOpen && onBoard(board.editErrorWorkItemId) ? (
        <PlaneBoardWriteErrorRow
          message={`Could not update the card — ${board.editError}`}
          onRetry={() => void board.retryEdit()}
          onDismiss={board.dismissEditError}
        />
      ) : null}

      {board.status === 'loading' ? (
        <View style={styles.placeholder}>
          <ActivityIndicator color={colors.textSecondary} />
          <Text style={styles.placeholderText}>Loading board…</Text>
        </View>
      ) : board.error ? (
        <View style={styles.placeholder}>
          <Text style={styles.errorText}>{board.error}</Text>
          <Pressable accessibilityRole="button" style={styles.emptyButton} onPress={board.refresh}>
            <Text style={styles.emptyButtonText}>Retry</Text>
          </Pressable>
        </View>
      ) : board.emptyState ? (
        <View style={styles.placeholder}>
          <Text style={styles.emptyTitle}>{board.emptyState.title}</Text>
          <Text style={styles.emptyBody}>{board.emptyState.body}</Text>
          {board.emptyState.actionLabel ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={board.emptyState.actionLabel}
              style={styles.emptyButton}
              onPress={onEmptyAction}
            >
              <Text style={styles.emptyButtonText}>{board.emptyState.actionLabel}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <FlatList
          data={board.activeColumn?.items ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.list, { paddingBottom: bottomInset + spacing.xl }]}
          refreshControl={
            <RefreshControl
              refreshing={board.refreshing}
              onRefresh={board.refresh}
              tintColor={colors.textSecondary}
            />
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item }) => {
            const facts = cardFacts(item)
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={item.title || item.identifier}
                style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
                onPress={() => onOpenCard(item)}
              >
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {item.title || 'Untitled work item'}
                </Text>
                <View style={styles.cardMeta}>
                  <Text style={styles.cardMetaText} numberOfLines={1}>
                    {item.identifier}
                  </Text>
                  <Text style={styles.cardMetaText}>{formatUpdatedAt(item.updatedAt)}</Text>
                </View>
                {facts.length > 0 ? (
                  <View style={styles.cardFacts}>
                    {facts.map((fact) => (
                      <Text key={fact} style={styles.cardMetaText} numberOfLines={1}>
                        {fact}
                      </Text>
                    ))}
                  </View>
                ) : null}
                {board.movingWorkItemIds.has(item.id) ? (
                  <Text style={styles.cardMoving}>Moving…</Text>
                ) : board.editingWorkItemIds.has(item.id) ? (
                  <Text style={styles.cardMoving}>Updating…</Text>
                ) : null}
              </Pressable>
            )
          }}
        />
      )}

      <PlaneBoardCreateDrawer
        visible={showCreate}
        columnName={board.activeColumn?.name ?? null}
        pending={board.create.pending}
        error={board.create.error}
        onSubmit={board.createCard}
        onClose={closeCreate}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  view: { flex: 1 },
  columnBar: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  columnChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.button,
    backgroundColor: colors.bgPanel
  },
  // Selection is weight and surface, not hue: color is reserved for state.
  columnChipActive: { backgroundColor: colors.bgRaised },
  columnName: { fontSize: typography.metaSize, color: colors.textSecondary },
  columnNameActive: { color: colors.textPrimary, fontWeight: '700' },
  columnCount: { fontSize: typography.metaSize, color: colors.textMuted },
  columnCountActive: { color: colors.textSecondary },
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
  list: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  separator: { height: spacing.sm },
  card: {
    padding: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.bgPanel,
    gap: spacing.xs
  },
  cardPressed: { backgroundColor: colors.bgRaised },
  cardTitle: { fontSize: typography.bodySize, color: colors.textPrimary, fontWeight: '600' },
  cardMeta: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  cardFacts: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  cardMetaText: { fontSize: typography.metaSize, color: colors.textMuted },
  cardMoving: { fontSize: typography.metaSize, color: colors.textSecondary }
})

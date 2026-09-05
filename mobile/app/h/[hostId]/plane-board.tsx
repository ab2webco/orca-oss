import { useCallback, useMemo, useState } from 'react'
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ChevronLeft, Plus } from 'lucide-react-native'
import { useHostClient } from '../../../src/transport/client-context'
import { BottomDrawer } from '../../../src/components/BottomDrawer'
import { colors, radii, spacing, typography } from '../../../src/theme/mobile-theme'
import { usePlaneBoard } from '../../../src/plane-board/use-plane-board'
import { formatUpdatedAt } from '../../../src/tasks/task-updated-at-time'
import type { PlaneMobileWorkItem } from '../../../src/tasks/plane-mobile-work-item-read'
import { PLANE_PRIORITY_LABELS } from '../../../src/tasks/plane-priority-label'
import { useRuntimeCapabilities } from '../../../src/plane-board/use-runtime-capabilities'
import { PlaneBoardCreateDrawer } from '../../../src/plane-board/plane-board-create-drawer'
import { PlaneBoardWriteErrorRow } from '../../../src/plane-board/plane-board-write-error-row'
import { PlaneWorkItemDetailSheet } from '../../../src/plane-board/plane-work-item-detail-sheet'

/** What the card shows besides its title: priority when set, then who holds it. */
function cardFacts(item: PlaneMobileWorkItem): string[] {
  const facts = item.priority === 'none' ? [] : [PLANE_PRIORITY_LABELS[item.priority]]
  return facts.concat(item.assignees.map((assignee) => assignee.displayName).filter(Boolean))
}

export default function PlaneBoardScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { hostId } = useLocalSearchParams<{ hostId: string }>()
  const { client, state: connState } = useHostClient(hostId)
  const connected = connState === 'connected'
  const capabilities = useRuntimeCapabilities(client, connected)
  const board = usePlaneBoard(client, connected, capabilities)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Resolved live so an optimistic edit shows in the sheet as well as on the card.
  const selected = useMemo(
    () =>
      board.columns.flatMap((column) => column.items).find((item) => item.id === selectedId) ??
      null,
    [board.columns, selectedId]
  )
  const [showProjectPicker, setShowProjectPicker] = useState(false)
  const [showCreate, setShowCreate] = useState(false)

  const onEmptyAction = useCallback(() => {
    const action = board.emptyState?.action
    if (action === 'pick-project') {
      setShowProjectPicker(true)
      return
    }
    if (action === 'refresh') {
      board.refresh()
    }
  }, [board])

  const closeCreate = useCallback(() => {
    setShowCreate(false)
    board.dismissCreateError()
  }, [board])

  const moveSelected = useCallback(
    (stateId: string) => {
      const item = selected
      setSelectedId(null)
      if (item) {
        void board.moveWorkItem(item, stateId)
      }
    },
    [board, selected]
  )

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.headerButton}
          onPress={() => router.back()}
        >
          <ChevronLeft size={20} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.headerTitles}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            Board
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {board.projectName ?? 'No project'}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose project"
          style={styles.headerButton}
          disabled={board.projects.length === 0}
          onPress={() => setShowProjectPicker(true)}
        >
          <Text style={styles.headerAction}>Project</Text>
        </Pressable>
        {board.canCreate ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add card"
            style={styles.headerButton}
            disabled={board.activeColumn === null}
            onPress={() => setShowCreate(true)}
          >
            <Plus size={20} color={board.activeColumn ? colors.textPrimary : colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

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
        </ScrollView>
      ) : null}

      {board.moveError ? (
        <Pressable style={styles.moveError} onPress={board.dismissMoveError}>
          <Text style={styles.moveErrorText}>Could not move the card — {board.moveError}</Text>
        </Pressable>
      ) : null}
      {board.editError && selected === null ? (
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
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.xl }]}
          refreshControl={
            <RefreshControl
              refreshing={board.refreshing}
              onRefresh={board.refresh}
              tintColor={colors.textSecondary}
            />
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={item.title || item.identifier}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              onPress={() => setSelectedId(item.id)}
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
              {cardFacts(item).length > 0 ? (
                <View style={styles.cardFacts}>
                  {cardFacts(item).map((fact) => (
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
          )}
        />
      )}

      <BottomDrawer visible={showProjectPicker} onClose={() => setShowProjectPicker(false)}>
        <View>
          <Text style={styles.moveLabel}>Project</Text>
          {board.projects.map((project) => (
            <Pressable
              key={project.id}
              accessibilityRole="button"
              accessibilityLabel={`Open ${project.name || project.identifier}`}
              style={styles.moveRow}
              onPress={() => {
                board.selectProject(project.id)
                setShowProjectPicker(false)
              }}
            >
              <Text style={styles.moveRowText}>{project.name || project.identifier}</Text>
              <Text style={styles.moveRowCount}>{project.identifier}</Text>
            </Pressable>
          ))}
        </View>
      </BottomDrawer>

      <PlaneBoardCreateDrawer
        visible={showCreate}
        columnName={board.activeColumn?.name ?? null}
        pending={board.create.pending}
        error={board.create.error}
        onSubmit={board.createCard}
        onClose={closeCreate}
      />

      <PlaneWorkItemDetailSheet
        item={selected}
        board={board}
        onMove={moveSelected}
        onClose={() => setSelectedId(null)}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bgBase },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle
  },
  headerButton: { paddingVertical: spacing.xs, paddingHorizontal: spacing.xs },
  headerTitles: { flex: 1, minWidth: 0 },
  headerTitle: { fontSize: typography.titleSize, fontWeight: '700', color: colors.textPrimary },
  headerSubtitle: { fontSize: typography.metaSize, color: colors.textMuted },
  headerAction: { fontSize: typography.bodySize, color: colors.textSecondary },
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
  cardMoving: { fontSize: typography.metaSize, color: colors.textSecondary },
  moveLabel: {
    fontSize: 11,
    color: colors.textMuted,
    paddingHorizontal: spacing.md + 2,
    marginBottom: spacing.xs
  },
  moveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md
  },
  moveRowText: { fontSize: typography.bodySize, color: colors.textPrimary },
  moveRowCount: { fontSize: typography.metaSize, color: colors.textMuted }
})

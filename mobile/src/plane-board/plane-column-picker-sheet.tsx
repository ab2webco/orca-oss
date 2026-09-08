import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Check } from 'lucide-react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { colors, spacing, typography } from '../theme/mobile-theme'
import { planeStateGroupColor } from './plane-board-sections'
import type { PlaneMobileWorkItem } from '../tasks/plane-mobile-work-item-read'
import type { PlaneBoardColumn } from './plane-board-columns'

type Props = {
  /** The card whose status pill was tapped; null keeps the sheet closed. */
  item: PlaneMobileWorkItem | null
  columns: readonly PlaneBoardColumn[]
  /** True while a write on this card is in flight. */
  moving: boolean
  onClose: () => void
  onMove: (stateId: string) => void
}

/**
 * The board's status pill promises a menu — it carries a chevron — and used to
 * open the detail instead, which is how it got reported as a broken dropdown
 * (ORCA-472). This is the menu.
 *
 * The current column stays in the list, marked, rather than being filtered out
 * the way the detail's "Move to" does: this opens from the pill that names it,
 * so removing it would leave the tap with nothing to confirm.
 *
 * No error surface of its own. `board.moveWorkItem` already overrides the card
 * optimistically, rolls it back when Plane refuses and reports why through the
 * board's own move-error row.
 */
export function PlaneColumnPickerSheet({ item, columns, moving, onClose, onMove }: Props) {
  const currentStateId = item?.state.id ?? null
  return (
    <BottomDrawer visible={item !== null} onClose={onClose} contentScrollable={false}>
      <View style={styles.header}>
        <Text style={styles.title}>Move to</Text>
      </View>
      {columns.length < 2 ? (
        <Text style={styles.note}>
          This project has only one column, so there is nowhere to move this card.
        </Text>
      ) : (
        <ScrollView style={styles.list}>
          <View style={styles.group}>
            {columns.map((column, index) => {
              const current = column.stateId === currentStateId
              return (
                <View key={column.stateId}>
                  {index > 0 ? <View style={styles.separator} /> : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      current ? `Stay in ${column.name}` : `Move to ${column.name}`
                    }
                    aria-checked={current}
                    disabled={moving}
                    style={styles.row}
                    // Tapping the column it is already in is a dismissal, not a write.
                    onPress={() => (current ? onClose() : onMove(column.stateId))}
                  >
                    <View
                      style={[
                        styles.dot,
                        { backgroundColor: column.color || planeStateGroupColor(column.group) }
                      ]}
                    />
                    <Text style={[styles.name, current && styles.nameCurrent]} numberOfLines={1}>
                      {column.name}
                    </Text>
                    <Text style={styles.count}>{column.items.length}</Text>
                    {current ? <Check size={15} color={colors.textPrimary} /> : null}
                  </Pressable>
                </View>
              )
            })}
          </View>
        </ScrollView>
      )}
    </BottomDrawer>
  )
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.xs, marginBottom: spacing.md },
  title: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, lineHeight: 20 },
  // Bounded: a project with many states scrolls its rows, not the sheet.
  list: { maxHeight: 360 },
  group: { backgroundColor: colors.bgPanel, borderRadius: 12, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.sm + 2
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  name: { flex: 1, minWidth: 0, fontSize: typography.bodySize, color: colors.textPrimary },
  nameCurrent: { fontWeight: '700' },
  count: { fontSize: typography.metaSize, color: colors.textMuted },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderSubtle,
    marginHorizontal: spacing.md
  },
  note: {
    fontSize: typography.metaSize,
    color: colors.textMuted,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.md
  }
})

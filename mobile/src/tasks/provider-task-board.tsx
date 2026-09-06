import type { ReactNode } from 'react'
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent
} from 'react-native'
import { ChevronDown } from 'lucide-react-native'
import { colors, radii, spacing } from '../theme/mobile-theme'

export type ProviderTaskBoardSection<Item> = {
  key: string
  label: string
  color: string
  items: readonly Item[]
}

type ProviderTaskStatus = {
  label: string
  color: string
  accessibilityLabel: string
}

type Props<Item> = {
  sections: readonly ProviderTaskBoardSection<Item>[]
  bottomInset: number
  getItemKey: (item: Item) => string
  getTitle: (item: Item) => string
  getSubtitle: (item: Item) => string
  getStatus?: (item: Item) => ProviderTaskStatus | null
  onPressItem: (item: Item) => void
  onPressStatus?: (item: Item) => void
  statusDisabled?: boolean
  createDrawerSlot?: ReactNode
  writeErrorSlot?: ReactNode
  /** Provider chrome under the column's title row, above its cards. */
  renderColumnHeaderSlot?: (section: ProviderTaskBoardSection<Item>) => ReactNode
  /** Provider chrome pinned below the column's cards: the cards scroll, this does not. */
  renderColumnFooterSlot?: (section: ProviderTaskBoardSection<Item>) => ReactNode
}

export function ProviderTaskBoard<Item>({
  sections,
  bottomInset,
  getItemKey,
  getTitle,
  getSubtitle,
  getStatus,
  onPressItem,
  onPressStatus,
  statusDisabled = false,
  createDrawerSlot,
  writeErrorSlot,
  renderColumnHeaderSlot,
  renderColumnFooterSlot
}: Props<Item>) {
  const pressStatus = (event: GestureResponderEvent, item: Item): void => {
    event.stopPropagation()
    onPressStatus?.(item)
  }

  return (
    <>
      {writeErrorSlot}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.container, { paddingBottom: spacing.lg + bottomInset }]}
      >
        {sections.map((section) => (
          <View key={section.key} style={styles.column} testID={`column-${section.key}`}>
            <View style={styles.header}>
              <View style={[styles.sectionDot, { backgroundColor: section.color }]} />
              <Text style={styles.columnTitle} numberOfLines={1}>
                {section.label}
              </Text>
              <Text style={styles.count}>{section.items.length}</Text>
            </View>
            {renderColumnHeaderSlot?.(section)}
            <ScrollView style={styles.columnScroll} showsVerticalScrollIndicator={false}>
              {section.items.map((item) => {
                const title = getTitle(item)
                const status = getStatus?.(item)
                return (
                  <Pressable
                    key={getItemKey(item)}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${title}`}
                    style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
                    onPress={() => onPressItem(item)}
                  >
                    <Text style={styles.cardTitle} numberOfLines={3}>
                      {title}
                    </Text>
                    <Text style={styles.subtitle} numberOfLines={2}>
                      {getSubtitle(item)}
                    </Text>
                    {status && onPressStatus ? (
                      <Pressable
                        style={styles.statusPill}
                        disabled={statusDisabled}
                        accessibilityRole="button"
                        accessibilityLabel={status.accessibilityLabel}
                        onPress={(event) => pressStatus(event, item)}
                      >
                        <View style={[styles.statusDot, { backgroundColor: status.color }]} />
                        <Text style={styles.statusText} numberOfLines={1}>
                          {status.label}
                        </Text>
                        <ChevronDown size={12} color={colors.textSecondary} />
                      </Pressable>
                    ) : null}
                  </Pressable>
                )
              })}
            </ScrollView>
            {renderColumnFooterSlot?.(section)}
          </View>
        ))}
      </ScrollView>
      {createDrawerSlot}
    </>
  )
}

const styles = StyleSheet.create({
  container: { gap: spacing.md, padding: spacing.md },
  column: {
    width: 280,
    maxHeight: '100%',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.card,
    backgroundColor: colors.bgPanel,
    overflow: 'hidden'
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle
  },
  // Lets the column's maxHeight squeeze the cards instead of pushing the footer slot out.
  columnScroll: { flexShrink: 1 },
  sectionDot: { width: 6, height: 6, borderRadius: 3 },
  columnTitle: { flex: 1, color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  count: { color: colors.textMuted, fontSize: 11 },
  card: {
    margin: spacing.sm,
    marginBottom: 0,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgBase,
    padding: spacing.md
  },
  cardPressed: { backgroundColor: colors.bgRaised },
  cardTitle: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18
  },
  subtitle: { flex: 1, color: colors.textSecondary, fontSize: 11 },
  statusPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgRaised
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { flex: 1, minWidth: 0, color: colors.textSecondary, fontSize: 11 }
})

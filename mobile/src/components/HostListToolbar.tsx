import type { ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Text } from '../theme/dynamic-type-text'
import { Filter, Layers, List, Search, SlidersHorizontal, UserCircle, X } from 'lucide-react-native'
import { MIN_TOUCH_TARGET, colors, spacing } from '../theme/mobile-theme'
import { HorizontalOverflowCue, useHorizontalOverflow } from './HorizontalOverflowCue'

export type HostListToolbarProps = {
  activeFilterCount: number
  sortLabel: string
  groupLabel: string
  connected: boolean
  showSearch: boolean
  onOpenFilter: () => void
  onOpenSort: () => void
  onOpenGroup: () => void
  onOpenAccounts: () => void
  onOpenTasks: () => void
  onToggleSearch: () => void
}

export function HostListToolbar({
  activeFilterCount,
  sortLabel,
  groupLabel,
  connected,
  showSearch,
  onOpenFilter,
  onOpenSort,
  onOpenGroup,
  onOpenAccounts,
  onOpenTasks,
  onToggleSearch
}: HostListToolbarProps) {
  // Why: at 320 dp the chips no longer fit beside the icons; they scroll instead of truncating.
  const overflow = useHorizontalOverflow()
  const filterActive = activeFilterCount > 0
  const iconColor = connected ? colors.textSecondary : colors.textMuted

  return (
    <View style={styles.toolbar}>
      <View style={styles.chipViewport}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
          {...overflow.scrollProps}
        >
          <ToolbarChip
            accessibilityLabel={filterActive ? `Filter, ${activeFilterCount} active` : 'Filter'}
            active={filterActive}
            bordered
            onPress={onOpenFilter}
            icon={
              <Filter size={12} color={filterActive ? colors.textPrimary : colors.textSecondary} />
            }
            text={`Filter${filterActive ? ` (${activeFilterCount})` : ''}`}
          />
          <ToolbarChip
            accessibilityLabel={`Sort by ${sortLabel}`}
            onPress={onOpenSort}
            icon={<SlidersHorizontal size={14} color={colors.textSecondary} />}
            text={sortLabel}
          />
          <ToolbarChip
            accessibilityLabel={`Group by ${groupLabel}`}
            onPress={onOpenGroup}
            icon={<Layers size={14} color={colors.textSecondary} />}
            text={groupLabel}
          />
        </ScrollView>
        {overflow.overflowing ? <HorizontalOverflowCue name="host-list-toolbar" /> : null}
      </View>

      <Pressable
        style={styles.iconButton}
        onPress={onOpenAccounts}
        disabled={!connected}
        accessibilityRole="button"
        accessibilityLabel="Accounts"
      >
        <UserCircle size={16} color={iconColor} />
      </Pressable>
      <Pressable
        style={styles.iconButton}
        onPress={onOpenTasks}
        disabled={!connected}
        accessibilityRole="button"
        accessibilityLabel="Tasks"
      >
        <List size={16} color={iconColor} />
      </Pressable>
      <Pressable
        style={styles.iconButton}
        onPress={onToggleSearch}
        accessibilityRole="button"
        accessibilityLabel={showSearch ? 'Close search' : 'Search workspaces'}
      >
        {showSearch ? (
          <X size={16} color={colors.textSecondary} />
        ) : (
          <Search size={16} color={colors.textSecondary} />
        )}
      </Pressable>
    </View>
  )
}

function ToolbarChip({
  accessibilityLabel,
  active = false,
  bordered = false,
  icon,
  onPress,
  text
}: {
  accessibilityLabel: string
  active?: boolean
  bordered?: boolean
  icon: ReactNode
  onPress: () => void
  text: string
}) {
  return (
    <Pressable
      style={styles.chipTarget}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <View style={[styles.chip, bordered && styles.chipBordered, active && styles.chipActive]}>
        {icon}
        <Text style={[styles.chipText, active && styles.chipTextActive]}>{text}</Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle
  },
  chipViewport: {
    flex: 1,
    minWidth: 0
  },
  chipRow: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingRight: spacing.sm
  },
  chipTarget: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    justifyContent: 'center'
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs
  },
  chipBordered: {
    paddingHorizontal: spacing.sm + 2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderSubtle
  },
  chipActive: {
    borderColor: colors.textSecondary,
    backgroundColor: colors.bgRaised
  },
  chipText: {
    fontSize: 12,
    color: colors.textSecondary
  },
  chipTextActive: {
    color: colors.textPrimary
  },
  iconButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center'
  }
})

import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import type { TeamAction } from '../../../src/shared/team-panel-actions'
import { Text, TextInput } from '../theme/dynamic-type-text'
import { colors, MIN_TOUCH_TARGET, radii, spacing, typography } from '../theme/mobile-theme'
import { teamActionHintOf, teamActionLabelOf, type TeamControlWords } from './team-control-words'

// Why a cap: the menu opens over the dock, and the sheet above it must stay in view.
const MENU_MAX_HEIGHT = 360

/** Every action, grouped as the desktop's menu (TeamActionMenu.tsx): Now, This project, From Orca. */
export function TeamActionMenu({
  actions,
  words,
  onPick,
  onClose
}: {
  actions: TeamAction[]
  words: TeamControlWords
  onPick: (action: TeamAction) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const hit = (one: TeamAction): boolean =>
    !q || teamActionLabelOf(one, words).toLowerCase().includes(q) || (one.command ?? '').includes(q)
  const groups: [string, TeamAction[]][] = [
    [words.menu.now, actions.filter((one) => one.now && hit(one))],
    [words.menu.project, actions.filter((one) => one.orca === null && hit(one))],
    [words.menu.orca, actions.filter((one) => one.orca !== null && !one.now && hit(one))]
  ]
  const shown = groups.filter(([, list]) => list.length > 0)
  return (
    <View style={styles.menu}>
      <View style={styles.searchLine}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={words.menu.search}
          placeholderTextColor={colors.textMuted}
          accessibilityLabel={words.menu.search}
          style={styles.search}
          autoCorrect={false}
        />
        <Pressable
          style={styles.close}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={words.cancel}
        >
          <Text style={styles.closeText}>{words.cancel}</Text>
        </Pressable>
      </View>
      <ScrollView style={{ maxHeight: MENU_MAX_HEIGHT }} keyboardShouldPersistTaps="handled">
        {shown.length === 0 ? <Text style={styles.none}>{words.menu.none}</Text> : null}
        {shown.map(([title, list]) => (
          <View key={title} style={styles.group}>
            <Text style={styles.title}>{title}</Text>
            <View style={styles.card}>
              {list.map((action) => {
                const stop = action.orca === 'stop'
                const label = stop ? words.stopAll : teamActionLabelOf(action, words)
                const right = action.now
                  ? teamActionHintOf(action, words)
                  : action.off
                    ? words.off[action.off]
                    : action.command
                      ? `/${action.command}`
                      : ''
                return (
                  <Pressable
                    key={action.id}
                    style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                    onPress={() => onPick(action)}
                    disabled={action.off !== null}
                    accessibilityRole="button"
                    accessibilityLabel={right ? `${label}, ${right}` : label}
                  >
                    <Text
                      style={[styles.label, stop && styles.stop, action.off && styles.off]}
                      numberOfLines={1}
                    >
                      {label}
                    </Text>
                    {right ? (
                      <Text style={styles.right} numberOfLines={1}>
                        {right}
                      </Text>
                    ) : null}
                  </Pressable>
                )
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  menu: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  searchLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  search: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    borderRadius: radii.button,
    backgroundColor: colors.bgBase,
    color: colors.textPrimary,
    fontSize: typography.bodySize
  },
  close: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm
  },
  closeText: {
    color: colors.textSecondary,
    fontSize: typography.metaSize + 1,
    fontWeight: '600'
  },
  none: {
    color: colors.textMuted,
    fontSize: typography.metaSize + 1
  },
  group: {
    gap: spacing.xs,
    marginBottom: spacing.sm
  },
  title: {
    color: colors.textSecondary,
    fontSize: typography.metaSize
  },
  card: {
    borderRadius: radii.card,
    backgroundColor: colors.bgBase
  },
  row: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle
  },
  pressed: {
    opacity: 0.7
  },
  label: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: typography.bodySize
  },
  stop: {
    color: colors.statusRed
  },
  off: {
    color: colors.textMuted
  },
  right: {
    color: colors.textMuted,
    fontSize: typography.metaSize
  }
})

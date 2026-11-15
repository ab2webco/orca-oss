import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '../theme/dynamic-type-text'
import { colors, MIN_TOUCH_TARGET, spacing, typography } from '../theme/mobile-theme'
import type { TeamCardWords } from './team-card-words'
import type { TeamSheetWork } from './team-sheet-work'
import type { TeamWorkWords } from './team-work-words'

export type TeamTab = 'team' | 'inbox' | 'prs'

/** Team and Inbox always; PRs only when the project has a remote to review on. */
export function TeamSheetTabBar({
  active,
  inboxCount,
  work,
  words,
  workWords,
  onSelect
}: {
  active: TeamTab
  inboxCount: number
  work: TeamSheetWork
  words: TeamCardWords
  workWords: TeamWorkWords
  onSelect: (tab: TeamTab) => void
}) {
  const tabs: { tab: TeamTab; label: string }[] = [
    { tab: 'team', label: words.team },
    { tab: 'inbox', label: words.inbox },
    ...(work.prs || work.queue ? [{ tab: 'prs' as const, label: workWords.prs }] : [])
  ]
  return (
    <View style={styles.tabs} accessibilityRole="tablist">
      {tabs.map(({ tab, label }) => {
        const selected = tab === active
        return (
          <Pressable
            key={tab}
            style={({ pressed }) => [
              styles.tab,
              selected && styles.tabActive,
              pressed && !selected && styles.tabPressed
            ]}
            onPress={() => onSelect(tab)}
            accessibilityRole="tab"
            aria-selected={selected}
            accessibilityLabel={label}
          >
            <Text style={[styles.tabText, selected && styles.tabTextActive]} numberOfLines={1}>
              {label}
            </Text>
            {tab === 'inbox' && inboxCount > 0 ? (
              <View style={styles.count}>
                <Text style={styles.countText}>{String(inboxCount)}</Text>
              </View>
            ) : null}
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: 'row',
    marginBottom: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle
  },
  tab: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    // Reserved so the active underline does not shift the row.
    borderBottomWidth: 2,
    borderBottomColor: 'transparent'
  },
  tabActive: {
    borderBottomColor: colors.textPrimary
  },
  tabPressed: {
    opacity: 0.7
  },
  tabText: {
    color: colors.textSecondary,
    fontSize: typography.bodySize,
    fontWeight: '600'
  },
  tabTextActive: {
    color: colors.textPrimary
  },
  count: {
    minWidth: 18,
    paddingHorizontal: spacing.xs,
    borderRadius: 9,
    backgroundColor: colors.statusRed,
    alignItems: 'center'
  },
  countText: {
    color: colors.onAccent,
    fontSize: typography.metaSize - 1,
    fontWeight: '700'
  }
})

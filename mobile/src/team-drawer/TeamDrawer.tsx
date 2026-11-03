import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { X } from 'lucide-react-native'
import { RightDrawer } from '../components/RightDrawer'
import { Text } from '../theme/dynamic-type-text'
import { colors, MIN_TOUCH_TARGET, radii, spacing, typography } from '../theme/mobile-theme'
import { formatLeadTime, type TeamDrawerData, type TeamMetrics } from './team-drawer-model'
import { TeamMemberCard } from './TeamMemberCard'
import { TeamInboxTab } from './TeamInboxTab'

type TeamTab = 'team' | 'inbox'

type Props = {
  visible: boolean
  onClose: () => void
  team: TeamDrawerData
  now: number
  onOpenLink: (url: string) => void
}

function MetricsSummary({ metrics }: { metrics: TeamMetrics }) {
  const tiles = [
    metrics.latestDay
      ? { label: `Merged ${metrics.latestDay.day}`, value: metrics.latestDay.merged }
      : null,
    // Why the no-break space: a narrow tile wrapped the "d" alone onto its own line.
    { label: `Merged in ${metrics.windowDays} d`, value: metrics.mergedInWindow },
    metrics.leadTimeMedianMs === null
      ? null
      : { label: 'Median lead time', value: formatLeadTime(metrics.leadTimeMedianMs) }
  ].filter((one) => one !== null)
  return (
    <View style={styles.metrics}>
      {tiles.map((tile) => (
        <View key={tile.label} style={styles.tile}>
          <Text style={styles.tileValue}>{String(tile.value)}</Text>
          <Text style={styles.tileLabel} numberOfLines={2}>
            {tile.label}
          </Text>
        </View>
      ))}
    </View>
  )
}

function TabBar({
  active,
  inboxCount,
  onSelect
}: {
  active: TeamTab
  inboxCount: number
  onSelect: (tab: TeamTab) => void
}) {
  const tabs: { tab: TeamTab; label: string }[] = [
    { tab: 'team', label: 'Team' },
    { tab: 'inbox', label: 'Inbox' }
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

/** The lead's Team and Inbox over its terminal, which keeps running beneath. */
export function TeamDrawer({ visible, onClose, team, now, onOpenLink }: Props) {
  const { view, questions } = team
  // Why null until picked: each open lands on the Inbox while a question waits, else on the Team.
  const [picked, setPicked] = useState<TeamTab | null>(null)
  const tab: TeamTab = picked ?? (questions.length > 0 ? 'inbox' : 'team')
  const close = (): void => {
    setPicked(null)
    onClose()
  }
  return (
    <RightDrawer visible={visible} onClose={close}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.heading}>Team</Text>
          <Pressable
            style={({ pressed }) => [styles.close, pressed && styles.closePressed]}
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel="Close Team"
          >
            <X size={22} color={colors.textPrimary} />
          </Pressable>
        </View>
        <TabBar active={tab} inboxCount={questions.length} onSelect={setPicked} />
        {tab === 'inbox' ? (
          <TeamInboxTab team={team} now={now} onOpenLink={onOpenLink} />
        ) : (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{`Members (${view?.members.length ?? 0})`}</Text>
              {view && view.members.length > 0 ? (
                view.members.map((member) => (
                  <TeamMemberCard key={member.key} member={member} onOpenLink={onOpenLink} />
                ))
              ) : (
                <Text style={styles.empty}>No members running.</Text>
              )}
            </View>
            {view?.metrics ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Metrics</Text>
                <MetricsSummary metrics={view.metrics} />
              </View>
            ) : null}
          </>
        )}
      </View>
    </RightDrawer>
  )
}

const styles = StyleSheet.create({
  // Why: RightDrawer's paddingRight is only the safe-area inset, 0 on most phones.
  content: {
    paddingRight: spacing.md
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm
  },
  heading: {
    color: colors.textPrimary,
    fontSize: typography.titleSize,
    fontWeight: '700'
  },
  close: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: radii.button,
    alignItems: 'center',
    justifyContent: 'center'
  },
  closePressed: {
    backgroundColor: colors.bgRaised
  },
  section: {
    gap: spacing.sm,
    marginBottom: spacing.lg
  },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: typography.metaSize,
    fontWeight: '700',
    textTransform: 'uppercase'
  },
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
  },
  empty: {
    color: colors.textMuted,
    fontSize: typography.bodySize
  },
  metrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  tile: {
    flexGrow: 1,
    flexBasis: 90,
    padding: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.bgPanel
  },
  tileValue: {
    color: colors.textPrimary,
    fontSize: typography.titleSize,
    fontWeight: '700'
  },
  tileLabel: {
    color: colors.textMuted,
    fontSize: typography.metaSize
  }
})

import { useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Text } from '../theme/dynamic-type-text'
import { colors, MIN_TOUCH_TARGET, radii, spacing, typography } from '../theme/mobile-theme'
import {
  formatLeadTime,
  teamPeekOf,
  type TeamDrawerData,
  type TeamMemberRow,
  type TeamMetrics,
  type TeamPeek
} from './team-drawer-model'
import { TeamMemberCard } from './TeamMemberCard'
import { teamCardWordsOf, type TeamCardWords } from './team-card-words'
import { TeamInboxTab } from './TeamInboxTab'
import { teamInboxWordsOf } from './team-inbox-words'

type TeamTab = 'team' | 'inbox'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  team: TeamDrawerData
  now: number
  onOpenLink: (url: string) => void
  onOpenTerminal: (terminal: NonNullable<TeamMemberRow['terminal']>) => void
}

/** V30's collapsed sheet height. */
export const TEAM_PEEK_HEIGHT = 60

function PeekBar({
  peek,
  open,
  words,
  onPress
}: {
  peek: TeamPeek
  open: boolean
  words: TeamCardWords
  onPress: () => void
}) {
  const tone = { question: colors.statusRed, working: colors.statusGreen, idle: colors.textMuted }[
    peek.tone
  ]
  return (
    <Pressable
      style={styles.peek}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={open ? words.closeTeam(peek.text) : words.openTeam(peek.text)}
      aria-expanded={open}
    >
      <View style={styles.grab} />
      <View style={styles.peekLine}>
        <View style={[styles.dot, { backgroundColor: tone }]} />
        <Text
          style={[styles.peekText, peek.tone === 'question' && { color: tone }]}
          numberOfLines={1}
        >
          {peek.text}
        </Text>
      </View>
    </Pressable>
  )
}

function MetricsSummary({ metrics, words }: { metrics: TeamMetrics; words: TeamCardWords }) {
  const tiles = [
    metrics.latestDay
      ? { label: words.mergedOn(metrics.latestDay.day), value: metrics.latestDay.merged }
      : null,
    { label: words.mergedIn(metrics.windowDays), value: metrics.mergedInWindow },
    metrics.leadTimeMedianMs === null
      ? null
      : { label: words.medianLeadTime, value: formatLeadTime(metrics.leadTimeMedianMs) }
  ].filter((one) => one !== null)
  return (
    <View style={styles.metrics}>
      {tiles.map((tile) => (
        <View key={tile.label} style={styles.metricRow}>
          <Text style={styles.metricLabel} numberOfLines={1}>
            {tile.label}
          </Text>
          <Text style={styles.metricValue}>{String(tile.value)}</Text>
        </View>
      ))}
    </View>
  )
}

function TabBar({
  active,
  inboxCount,
  words,
  onSelect
}: {
  active: TeamTab
  inboxCount: number
  words: TeamCardWords
  onSelect: (tab: TeamTab) => void
}) {
  const tabs: { tab: TeamTab; label: string }[] = [
    { tab: 'team', label: words.team },
    { tab: 'inbox', label: words.inbox }
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

/** The lead's Team as a bottom sheet over its terminal: a 60 pt peek that opens to 84%. */
export function TeamSheet({ open, onOpenChange, team, now, onOpenLink, onOpenTerminal }: Props) {
  const { view, questions } = team
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  // Why null until picked: each open lands on the Inbox while a question waits, else on the Team.
  const [picked, setPicked] = useState<TeamTab | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  if (!view) {
    return null
  }
  const tab: TeamTab = picked ?? (questions.length > 0 ? 'inbox' : 'team')
  const words = teamCardWordsOf(view.locale)
  const peek = teamPeekOf(
    view,
    questions.length,
    questions.flatMap((one) => (one.ticket ? [one.ticket.toUpperCase()] : [])),
    words
  )
  const close = (): void => {
    setPicked(null)
    onOpenChange(false)
  }
  return (
    <View style={[styles.dock, { paddingBottom: insets.bottom }]}>
      <PeekBar peek={peek} open={false} words={words} onPress={() => onOpenChange(true)} />
      <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
        {/* Why no scrim: the lead's terminal stays readable above the sheet, as in V30. */}
        <Pressable style={styles.above} onPress={close} accessible={false} />
        <View style={[styles.dock, styles.sheet, { height: Math.round(height * 0.84) }]}>
          <PeekBar peek={peek} open words={words} onPress={close} />
          {/* Why keyed: a tab switch (Answer in Inbox) must not keep the other tab's scroll and hide the tabs. */}
          <ScrollView
            key={tab}
            contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.lg }]}
          >
            <TabBar active={tab} inboxCount={questions.length} words={words} onSelect={setPicked} />
            {tab === 'inbox' ? (
              <TeamInboxTab
                team={team}
                now={now}
                words={teamInboxWordsOf(view.locale)}
                onOpenLink={onOpenLink}
              />
            ) : (
              <>
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>{words.members(view.members.length)}</Text>
                  {view.members.length > 0 ? (
                    view.members.map((member) => (
                      <TeamMemberCard
                        key={member.key}
                        member={member}
                        now={now}
                        words={words}
                        expanded={expanded === member.key}
                        onToggle={() => setExpanded(expanded === member.key ? null : member.key)}
                        onAnswer={() => setPicked('inbox')}
                        onOpenLink={onOpenLink}
                        onOpenTerminal={(terminal) => {
                          close()
                          onOpenTerminal(terminal)
                        }}
                      />
                    ))
                  ) : (
                    <Text style={styles.empty}>{words.noMembersRunning}</Text>
                  )}
                </View>
                {view.metrics ? (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>{words.metrics}</Text>
                    <MetricsSummary metrics={view.metrics} words={words} />
                  </View>
                ) : null}
              </>
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  dock: {
    backgroundColor: colors.bgPanel,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card
  },
  peek: {
    height: TEAM_PEEK_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7
  },
  grab: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.textMuted
  },
  peekLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: spacing.lg
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4
  },
  peekText: {
    color: colors.textSecondary,
    fontSize: typography.metaSize + 1
  },
  above: {
    flex: 1
  },
  sheet: {
    overflow: 'hidden'
  },
  content: {
    paddingHorizontal: spacing.lg
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
  // Why rows: side-by-side tiles at 320 pt split the date label and orphaned the third tile.
  metrics: {
    flexDirection: 'column',
    borderRadius: radii.card,
    backgroundColor: colors.bgPanel,
    paddingHorizontal: spacing.md
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle
  },
  metricLabel: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: typography.bodySize
  },
  metricValue: {
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    fontWeight: '700'
  }
})

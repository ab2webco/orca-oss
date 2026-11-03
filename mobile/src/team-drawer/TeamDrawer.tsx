import { Pressable, StyleSheet, View } from 'react-native'
import { X } from 'lucide-react-native'
import { RightDrawer } from '../components/RightDrawer'
import { GameInboxQuestionCard } from '../game-inbox/GameInboxQuestionCard'
import { Text } from '../theme/dynamic-type-text'
import { colors, MIN_TOUCH_TARGET, radii, spacing, typography } from '../theme/mobile-theme'
import { formatLeadTime, type TeamDrawerData, type TeamMetrics } from './team-drawer-model'
import { TeamMemberCard } from './TeamMemberCard'

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
      ? { label: `Merged on ${metrics.latestDay.day}`, value: metrics.latestDay.merged }
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

/** The lead's questions, members and metrics over its terminal, which keeps running beneath. */
export function TeamDrawer({ visible, onClose, team, now, onOpenLink }: Props) {
  const { view, questions } = team
  return (
    <RightDrawer visible={visible} onClose={onClose} fillPhone>
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.heading}>Team</Text>
          <Pressable
            style={({ pressed }) => [styles.close, pressed && styles.closePressed]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close Team"
          >
            <X size={22} color={colors.textPrimary} />
          </Pressable>
        </View>
        {questions.length > 0 ? (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, styles.danger]}>
              {`Needs your answer (${questions.length})`}
            </Text>
            {questions.map((question) => (
              <GameInboxQuestionCard
                key={question.id}
                question={question}
                worktreeId={team.answerWorktreeId}
                now={now}
                onAnswer={(reply) => team.answer(question.id, reply)}
                onOpenLink={onOpenLink}
              />
            ))}
          </View>
        ) : null}
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
  danger: {
    color: colors.statusRed
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

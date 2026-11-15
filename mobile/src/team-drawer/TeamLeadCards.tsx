import { StyleSheet, View } from 'react-native'
import type { TeamAdvisorRow, TeamLeadCard } from '../../../src/shared/team-panel-model-types'
import { Text } from '../theme/dynamic-type-text'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import type { TeamCardWords } from './team-card-words'
import { teamLeadLiveText } from './team-sheet-lead'
import { TEAM_STATUS_TONE } from './team-status-tone'

function Head({ name, badge, side }: { name: string; badge: string; side: string | null }) {
  return (
    <View style={styles.top}>
      <Text style={styles.name} numberOfLines={1}>
        {name}
      </Text>
      <Text style={styles.mono}>{badge}</Text>
      {side ? (
        <Text style={[styles.mono, styles.side]} numberOfLines={1}>
          {side}
        </Text>
      ) : null}
    </View>
  )
}

export function TeamLeadCardView({
  lead,
  memberCount,
  hostName,
  words
}: {
  lead: TeamLeadCard
  memberCount: number
  /** The paired desktop's name, for a lead on that desktop. */
  hostName: string | null
  words: TeamCardWords
}) {
  const tone = TEAM_STATUS_TONE[lead.status]
  const model = lead.model
    ? lead.model.effort
      ? `${lead.model.label} · ${lead.model.effort}`
      : lead.model.label
    : null
  return (
    <View style={styles.card}>
      <Head
        name={lead.name}
        badge={words.lead}
        side={lead.host.kind === 'remote' ? lead.host.name : hostName}
      />
      <View style={styles.statusLine}>
        <View style={[styles.dot, { backgroundColor: tone }]} />
        <Text
          style={[styles.status, lead.status === 'attention' && { color: tone }]}
          numberOfLines={2}
        >
          {teamLeadLiveText(lead, words)}
        </Text>
      </View>
      <Text style={styles.meta} numberOfLines={2}>
        {[model, words.coordinates(memberCount)].filter(Boolean).join(' · ')}
      </Text>
    </View>
  )
}

// Why the whole line: Jev's sentence names the model and why; a cut line read as a broken card (ORCA-1173).
export function TeamAdvisorCardView({
  advisor,
  words
}: {
  advisor: TeamAdvisorRow
  words: TeamCardWords
}) {
  return (
    <View style={styles.card}>
      <Head name={words.advisorName} badge={words.advisor} side={words.advisorSource} />
      {advisor.line ? <Text style={styles.line}>{advisor.line}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.md,
    gap: spacing.xs,
    borderRadius: radii.card,
    backgroundColor: colors.bgBase,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle
  },
  top: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm
  },
  name: {
    flexShrink: 1,
    color: colors.textPrimary,
    fontSize: typography.bodySize + 1,
    fontWeight: '600'
  },
  mono: {
    color: colors.textMuted,
    fontFamily: typography.monoFamily,
    fontSize: typography.metaSize
  },
  side: {
    flex: 1,
    textAlign: 'right'
  },
  statusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4
  },
  status: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: typography.bodySize
  },
  line: {
    color: colors.textSecondary,
    fontSize: typography.bodySize
  },
  meta: {
    color: colors.textMuted,
    fontSize: typography.metaSize
  }
})

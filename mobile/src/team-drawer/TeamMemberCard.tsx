import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '../theme/dynamic-type-text'
import { colors, MIN_TOUCH_TARGET, radii, spacing, typography } from '../theme/mobile-theme'
import type { TeamMemberRow } from './team-drawer-model'

const STATE_TONE: Record<TeamMemberRow['state'], string> = {
  waiting: colors.statusAmber,
  working: colors.statusGreen,
  idle: colors.textMuted,
  done: colors.statusPurple
}

const CI_TONE: Record<string, string> = {
  success: colors.statusGreen,
  failure: colors.statusRed,
  pending: colors.statusAmber
}

type Props = { member: TeamMemberRow; onOpenLink: (url: string) => void }

export function TeamMemberCard({ member, onOpenLink }: Props) {
  const tone = STATE_TONE[member.state]
  const runner = [member.host ?? 'this host', member.agent, member.model]
    .filter(Boolean)
    .join(' · ')
  const pr = member.pr
  return (
    <View style={[styles.card, member.needsYou && styles.needsYou]}>
      <View style={styles.top}>
        <Text style={styles.ticket} numberOfLines={1}>
          {member.ticket ?? member.name}
        </Text>
        <View style={[styles.pill, { borderColor: tone }]}>
          <Text style={[styles.pillLabel, { color: tone }]}>{member.state}</Text>
        </View>
      </View>
      <Text style={styles.title} numberOfLines={2}>
        {member.title ?? member.name}
      </Text>
      <Text style={styles.meta} numberOfLines={1}>
        {runner}
      </Text>
      {pr || member.ticketStatus ? (
        <View style={styles.bottom}>
          {pr ? (
            <Pressable
              style={styles.prButton}
              onPress={() => onOpenLink(pr.url)}
              accessibilityRole="link"
              accessibilityLabel={`Open PR ${pr.number}, CI ${pr.ci}`}
            >
              <Text style={styles.prLabel}>{`PR #${pr.number}`}</Text>
              {pr.ci === 'none' ? null : (
                <Text style={[styles.ci, { color: CI_TONE[pr.ci] ?? colors.textMuted }]}>
                  {pr.state === 'merged' ? 'merged' : `CI ${pr.ci}`}
                </Text>
              )}
            </Pressable>
          ) : null}
          {member.ticketStatus ? (
            <Text style={styles.meta} numberOfLines={1}>
              {member.ticketStatus}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.md,
    gap: spacing.xs,
    borderRadius: radii.card,
    backgroundColor: colors.bgPanel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle
  },
  needsYou: {
    borderLeftWidth: 3,
    borderLeftColor: colors.statusRed
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  ticket: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    fontWeight: '700'
  },
  pill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1
  },
  pillLabel: {
    fontSize: typography.metaSize,
    fontWeight: '600'
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.bodySize
  },
  meta: {
    color: colors.textMuted,
    fontSize: typography.metaSize
  },
  bottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm
  },
  prButton: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  prLabel: {
    color: colors.accentBlue,
    fontSize: typography.metaSize + 1,
    fontWeight: '600'
  },
  ci: {
    fontSize: typography.metaSize,
    fontWeight: '600'
  }
})

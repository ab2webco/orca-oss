import { Pressable, StyleSheet, View } from 'react-native'
import type { CheckStatus } from '../../../src/shared/github/pull-request-types'
import { Text } from '../theme/dynamic-type-text'
import { colors, MIN_TOUCH_TARGET, radii, spacing, typography } from '../theme/mobile-theme'
import { teamAgeText, type TeamMemberRow } from './team-drawer-model'

const STATE: Record<TeamMemberRow['state'], { text: string; tone: string }> = {
  waiting: { text: 'Waiting for you', tone: colors.statusRed },
  working: { text: 'Working', tone: colors.statusGreen },
  idle: { text: 'Idle', tone: colors.textMuted },
  done: { text: 'Done', tone: colors.statusPurple }
}

const CI: Partial<Record<CheckStatus, { text: string; tone: string }>> = {
  success: { text: 'CI green', tone: colors.statusGreen },
  failure: { text: 'CI failing', tone: colors.statusRed },
  pending: { text: 'CI running', tone: colors.statusAmber }
}

/** What the member does now; a limit or a logout outranks its tool. */
function statusOf(member: TeamMemberRow, now: number): { text: string; tone: string } {
  if (member.needsYou) {
    return { text: 'Waiting for your answer', tone: colors.statusRed }
  }
  if (member.limit) {
    if (member.limit.loggedOut) {
      return { text: 'Logged out', tone: colors.statusRed }
    }
    const resets = member.limit.resetsAt
    return {
      text:
        resets && resets > now
          ? `Usage limit · resets in ${teamAgeText(now, resets)}`
          : 'Usage limit reached',
      tone: colors.statusAmber
    }
  }
  return { ...STATE[member.state], text: member.live ?? STATE[member.state].text }
}

type Props = { member: TeamMemberRow; now: number; onOpenLink: (url: string) => void }

export function TeamMemberCard({ member, now, onOpenLink }: Props) {
  const status = statusOf(member, now)
  const meta = [
    member.model,
    member.since === null ? null : teamAgeText(member.since, now),
    member.ticketStatus
  ]
    .filter(Boolean)
    .join(' · ')
  const pr = member.pr
  const account = member.account
  const ci = pr
    ? pr.state === 'merged'
      ? 'Merged'
      : (CI[pr.ci as CheckStatus]?.text ?? null)
    : null
  const ciTone = CI[pr?.ci as CheckStatus]?.tone ?? colors.textMuted
  return (
    <View style={[styles.card, member.needsYou && styles.needsYou]}>
      <View style={styles.top}>
        <Text style={styles.name} numberOfLines={1}>
          {member.name}
        </Text>
        {member.ticket && member.ticket !== member.name ? (
          <Text style={styles.mono}>{member.ticket}</Text>
        ) : null}
        <Text style={[styles.mono, styles.host]} numberOfLines={1}>
          {member.host ?? 'local'}
        </Text>
      </View>
      <View style={styles.statusLine}>
        <View style={[styles.dot, { backgroundColor: status.tone }]} />
        <Text style={[styles.status, member.needsYou && { color: status.tone }]} numberOfLines={1}>
          {status.text}
        </Text>
      </View>
      {meta ? (
        <Text style={styles.meta} numberOfLines={2}>
          {meta}
        </Text>
      ) : null}
      {account ? (
        <Text style={styles.meta} numberOfLines={1}>
          {account.usedPercent === null
            ? account.email
            : `${account.email} · ${account.usedPercent}%`}
        </Text>
      ) : null}
      {pr ? (
        <Pressable
          style={styles.prButton}
          onPress={() => onOpenLink(pr.url)}
          accessibilityRole="link"
          accessibilityLabel={`Open PR ${pr.number}${ci ? `, ${ci}` : ''}`}
        >
          <Text style={styles.prLabel}>{`PR #${pr.number}`}</Text>
          {ci ? <Text style={[styles.ci, { color: ciTone }]}>{ci}</Text> : null}
          {pr.ciHistory.length > 0 ? (
            <View
              style={styles.heads}
              accessible
              accessibilityLabel={`CI per push: ${pr.ciHistory.map((head) => head.ci).join(', ')}`}
            >
              {pr.ciHistory.slice(-6).map((head) => (
                <View
                  key={head.headSha}
                  style={[styles.head, { backgroundColor: CI[head.ci]?.tone ?? colors.textMuted }]}
                />
              ))}
            </View>
          ) : null}
          {pr.comments ? (
            <Text style={styles.meta}>
              {`${pr.comments} comment${pr.comments === 1 ? '' : 's'}`}
            </Text>
          ) : null}
        </Pressable>
      ) : null}
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
  needsYou: {
    borderLeftWidth: 3,
    borderLeftColor: colors.statusRed
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
  host: {
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
  meta: {
    color: colors.textMuted,
    fontSize: typography.metaSize
  },
  prButton: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: spacing.sm
  },
  prLabel: {
    color: colors.accentBlue,
    fontSize: typography.metaSize + 1,
    fontWeight: '600'
  },
  ci: {
    fontSize: typography.metaSize,
    fontWeight: '600'
  },
  heads: {
    flexDirection: 'row',
    gap: 3
  },
  head: {
    width: 6,
    height: 6,
    borderRadius: 3
  }
})

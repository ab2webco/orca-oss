import { Pressable, StyleSheet, View } from 'react-native'
import type { CheckStatus } from '../../../src/shared/github/pull-request-types'
import { Text } from '../theme/dynamic-type-text'
import { colors, MIN_TOUCH_TARGET, radii, spacing, typography } from '../theme/mobile-theme'
import { teamAgeText, type TeamMemberRow } from './team-drawer-model'
import type { TeamCardWords } from './team-card-words'

const TONE: Record<TeamMemberRow['state'], string> = {
  waiting: colors.statusRed,
  working: colors.statusGreen,
  idle: colors.textMuted,
  done: colors.statusPurple
}

const CI_TONE: Partial<Record<CheckStatus, string>> = {
  success: colors.statusGreen,
  failure: colors.statusRed,
  pending: colors.statusAmber
}

const ciText = (ci: CheckStatus | 'none', words: TeamCardWords): string | null =>
  ({ success: words.ciGreen, failure: words.ciFailing, pending: words.ciRunning })[
    ci as 'success'
  ] ?? null

/** What the member does now; a limit or a logout outranks its tool. */
function statusOf(
  member: TeamMemberRow,
  now: number,
  words: TeamCardWords
): { text: string; tone: string } {
  if (member.needsYou) {
    return { text: words.waitingForAnswer, tone: colors.statusRed }
  }
  if (member.limit) {
    if (member.limit.loggedOut) {
      return { text: words.loggedOut, tone: colors.statusRed }
    }
    const resets = member.limit.resetsAt
    return {
      text:
        resets && resets > now ? words.limitResetsIn(teamAgeText(now, resets)) : words.limitReached,
      tone: colors.statusAmber
    }
  }
  return { text: member.live ?? words.state[member.state], tone: TONE[member.state] }
}

function usageText(account: NonNullable<TeamMemberRow['account']>): string {
  const parts = [
    account.usedPercent === null ? null : `5 h ${account.usedPercent}%`,
    account.weeklyPercent === null ? null : `7 d ${account.weeklyPercent}%`
  ]
  return [account.email, ...parts].filter(Boolean).join(' · ')
}

type Props = {
  member: TeamMemberRow
  now: number
  words: TeamCardWords
  expanded: boolean
  onToggle: () => void
  onAnswer: () => void
  onOpenLink: (url: string) => void
  onOpenTerminal: (terminal: NonNullable<TeamMemberRow['terminal']>) => void
}

export function TeamMemberCard({
  member,
  now,
  words,
  expanded,
  onToggle,
  onAnswer,
  onOpenLink,
  onOpenTerminal
}: Props) {
  const status = statusOf(member, now, words)
  const meta = [
    member.model,
    member.phase ? words.phase[member.phase] : null,
    member.since === null ? null : teamAgeText(member.since, now),
    member.ticketStatus
  ]
    .filter(Boolean)
    .join(' · ')
  const pr = member.pr
  const account = member.account
  const ci = pr ? (pr.state === 'merged' ? words.merged : ciText(pr.ci, words)) : null
  const ciTone = CI_TONE[pr?.ci as CheckStatus] ?? colors.textMuted
  const terminal = member.terminal
  return (
    <View style={[styles.card, member.needsYou && styles.needsYou]}>
      <Pressable
        style={styles.head}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={`${member.name}, ${status.text}`}
        aria-expanded={expanded}
      >
        <View style={styles.top}>
          <Text style={styles.name} numberOfLines={1}>
            {member.name}
          </Text>
          {member.ticket && member.ticket !== member.name ? (
            <Text style={styles.mono}>{member.ticket}</Text>
          ) : null}
          <Text style={[styles.mono, styles.host]} numberOfLines={1}>
            {member.host ?? words.local}
          </Text>
        </View>
        <View style={styles.statusLine}>
          <View style={[styles.dot, { backgroundColor: status.tone }]} />
          <Text
            style={[styles.status, member.needsYou && { color: status.tone }]}
            numberOfLines={expanded ? undefined : 1}
          >
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
            {usageText(account)}
          </Text>
        ) : null}
      </Pressable>
      {member.needsYou ? (
        <Pressable
          style={[styles.action, styles.answer]}
          onPress={onAnswer}
          accessibilityRole="button"
          accessibilityLabel={words.answerInInbox}
        >
          <Text style={styles.answerText}>{words.answerInInbox}</Text>
        </Pressable>
      ) : null}
      {expanded && member.title ? <Text style={styles.title}>{member.title}</Text> : null}
      {expanded && member.summary ? <Text style={styles.meta}>{member.summary}</Text> : null}
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
              accessibilityLabel={`CI per push: ${pr.ciHistory.map((one) => one.ci).join(', ')}`}
            >
              {pr.ciHistory.slice(-6).map((one) => (
                <View
                  key={one.headSha}
                  style={[
                    styles.dotSmall,
                    { backgroundColor: CI_TONE[one.ci] ?? colors.textMuted }
                  ]}
                />
              ))}
            </View>
          ) : null}
          {pr.comments ? <Text style={styles.meta}>{words.comments(pr.comments)}</Text> : null}
        </Pressable>
      ) : null}
      {expanded ? (
        terminal ? (
          <Pressable
            style={[styles.action, styles.outline]}
            onPress={() => onOpenTerminal(terminal)}
            accessibilityRole="button"
            accessibilityLabel={words.openTerminal}
          >
            <Text style={styles.outlineText}>{words.openTerminal}</Text>
          </Pressable>
        ) : member.host ? (
          <Text style={styles.meta}>{words.terminalOnHost(member.host)}</Text>
        ) : null
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
  head: {
    gap: spacing.xs
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
    alignContent: 'center',
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
  dotSmall: {
    width: 6,
    height: 6,
    borderRadius: 3
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.bodySize
  },
  action: {
    minHeight: MIN_TOUCH_TARGET,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.button
  },
  answer: {
    backgroundColor: colors.textPrimary
  },
  answerText: {
    color: colors.bgBase,
    fontSize: typography.metaSize + 1,
    fontWeight: '600'
  },
  outline: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle
  },
  outlineText: {
    color: colors.textPrimary,
    fontSize: typography.metaSize + 1,
    fontWeight: '600'
  }
})

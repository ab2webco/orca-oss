import { Pressable, StyleSheet, View } from 'react-native'
import type { TeamPrRow, TeamQueueEntry } from '../../../src/shared/team-panel-model-types'
import { Text } from '../theme/dynamic-type-text'
import { colors, MIN_TOUCH_TARGET, radii, spacing, typography } from '../theme/mobile-theme'
import { teamSectionNote } from './team-section-note'
import type { TeamSheetWork } from './team-sheet-work'
import { TEAM_STATUS_ROLE, useTeamTones } from './team-status-tone'
import type { TeamWorkWords } from './team-work-words'

function Row({
  lead,
  title,
  side,
  status,
  label,
  onPress
}: {
  lead: string
  title: string
  side: string
  status: TeamPrRow['status']
  label: string
  onPress: () => void
}) {
  const tones = useTeamTones()
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={label}
    >
      <Text style={styles.mono}>{lead}</Text>
      <Text style={styles.rowTitle} numberOfLines={1}>
        {title}
      </Text>
      <View style={[styles.dot, { backgroundColor: tones[TEAM_STATUS_ROLE[status]] }]} />
      <Text style={styles.side}>{side}</Text>
    </Pressable>
  )
}

function queueSide(entry: TeamQueueEntry, words: TeamWorkWords): string {
  return entry.longWaitHours === null
    ? words.queue[entry.state]
    : `${words.queue[entry.state]} · ${words.longWait(entry.longWaitHours)}`
}

/** The merge queue first, then open PRs, as V30's PRs tab. */
export function TeamPrsTab({
  work,
  words,
  onOpenLink
}: {
  work: TeamSheetWork
  words: TeamWorkWords
  onOpenLink: (url: string) => void
}) {
  const { prs, queue } = work
  const entries = queue?.kind === 'ready' ? queue.value : []
  const queueNote = queue?.kind === 'error' ? teamSectionNote(queue, words.queueError, words) : null
  const list = prs?.kind === 'ready' ? prs.value : null
  const prsNote = prs ? teamSectionNote(prs, words.prsError, words) : null
  return (
    <View style={styles.tab}>
      {entries.length > 0 ? (
        <View style={styles.section}>
          <View style={styles.titleLine}>
            <Text style={styles.title}>{words.mergeQueue}</Text>
            <Text style={styles.count}>{String(entries.length)}</Text>
          </View>
          <View style={styles.card}>
            {entries.map((entry) => (
              <Row
                key={entry.url}
                lead={`${entry.position}  ${entry.label}`}
                title={entry.title}
                side={queueSide(entry, words)}
                status={entry.status}
                label={`${entry.label} ${entry.title}, ${queueSide(entry, words)}`}
                onPress={() => onOpenLink(entry.url)}
              />
            ))}
          </View>
        </View>
      ) : null}
      {queueNote ? <Text style={styles.note}>{queueNote}</Text> : null}
      {prs ? (
        <View style={styles.section}>
          <Text style={styles.title}>{words.openPrs}</Text>
          {prsNote ? <Text style={styles.note}>{prsNote}</Text> : null}
          {list && list.rows.length === 0 ? <Text style={styles.note}>{words.noPrs}</Text> : null}
          {list && list.rows.length > 0 ? (
            <View style={styles.card}>
              {list.rows.map((row) => (
                <Row
                  key={row.url}
                  lead={row.label}
                  title={row.title}
                  side={words.reason[row.reason]}
                  status={row.status}
                  label={`${row.label} ${row.title}, ${words.reason[row.reason]}`}
                  onPress={() => onOpenLink(row.url)}
                />
              ))}
            </View>
          ) : null}
          {list && list.listUrl && list.total > list.rows.length ? (
            <Pressable
              style={styles.more}
              onPress={() => onOpenLink(list.listUrl as string)}
              accessibilityRole="link"
            >
              <Text style={styles.moreText}>{words.viewAll(list.total)}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  tab: {
    gap: spacing.md,
    marginBottom: spacing.lg
  },
  section: {
    gap: spacing.sm
  },
  titleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  title: {
    color: colors.textSecondary,
    fontSize: typography.metaSize + 1,
    fontWeight: '600'
  },
  count: {
    color: colors.textMuted,
    fontSize: typography.metaSize
  },
  card: {
    borderRadius: radii.card,
    backgroundColor: colors.bgBase,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle
  },
  pressed: {
    opacity: 0.7
  },
  mono: {
    color: colors.textMuted,
    fontFamily: typography.monoFamily,
    fontSize: typography.metaSize
  },
  rowTitle: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: typography.bodySize
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4
  },
  side: {
    color: colors.textSecondary,
    fontSize: typography.metaSize
  },
  note: {
    color: colors.textMuted,
    fontSize: typography.metaSize + 1
  },
  more: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center'
  },
  moreText: {
    color: colors.accentBlue,
    fontSize: typography.metaSize + 1,
    fontWeight: '600'
  }
})

import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { ChevronDown, ChevronRight } from 'lucide-react-native'
import type { GameInboxThread } from '../../../src/shared/orchestrator-game-inbox-threads'
import { Text } from '../theme/dynamic-type-text'
import { colors, MIN_TOUCH_TARGET, radii, spacing, typography } from '../theme/mobile-theme'
import { formatTimeAgo } from '../worktree/agent-row-display'

// Why a cap: a long thread would push every other ticket off the phone; the desktop keeps it whole.
const THREAD_MESSAGES_SHOWN = 20

export const timeAgoOf = (iso: string, now: number): string | null => {
  const at = Date.parse(iso)
  return Number.isNaN(at) ? null : formatTimeAgo(at, now)
}

/** One ticket's mail with the lead, collapsed to its last message until tapped. */
export function TeamInboxThreadRow({ thread, now }: { thread: GameInboxThread; now: number }) {
  const [open, setOpen] = useState(false)
  const last = thread.messages.at(-1)
  const count = thread.messages.length
  const shown = thread.messages.slice(-THREAD_MESSAGES_SHOWN)
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <View style={styles.card}>
      <Pressable
        style={({ pressed }) => [styles.head, pressed && styles.pressed]}
        onPress={() => setOpen((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${open ? 'Close' : 'Open'} the ${thread.ticket} thread, ${count} message${count === 1 ? '' : 's'}`}
      >
        <Chevron size={16} color={colors.textSecondary} />
        <View style={styles.headText}>
          <View style={styles.meta}>
            <Text style={styles.ticket}>{thread.ticket}</Text>
            {thread.waiting > 0 ? (
              <Text style={styles.waiting}>{`${thread.waiting} waiting`}</Text>
            ) : null}
            <Text style={styles.age}>{timeAgoOf(thread.last, now) ?? ''}</Text>
          </View>
          {last ? (
            <Text style={styles.subject} numberOfLines={1}>
              {last.subject}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {open ? (
        <View style={styles.messages}>
          {count > shown.length ? (
            <Text style={styles.age}>
              {`Last ${shown.length} of ${count}; the rest are on the computer.`}
            </Text>
          ) : null}
          {shown.map((message) => (
            <View key={message.id} style={styles.message}>
              <View style={styles.meta}>
                <Text style={styles.route}>{`${message.from} → ${message.to}`}</Text>
                <Text style={styles.age}>{message.kind}</Text>
                <Text style={styles.age}>{timeAgoOf(message.at, now) ?? ''}</Text>
              </View>
              {message.failure ? (
                <Text style={styles.failure}>
                  {message.failure.kind === 'rejected' ? 'Rejected' : 'Failed'}
                  {message.failure.reason ? `: ${message.failure.reason}` : ''}
                </Text>
              ) : null}
              <Text style={styles.body} numberOfLines={8}>
                {message.body || message.subject}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  )
}

export const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgPanel,
    borderRadius: radii.card,
    overflow: 'hidden'
  },
  head: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md
  },
  pressed: {
    backgroundColor: colors.bgRaised
  },
  headText: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs
  },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: spacing.sm
  },
  ticket: {
    color: colors.textSecondary,
    fontSize: typography.metaSize,
    fontWeight: '600'
  },
  waiting: {
    color: colors.statusAmber,
    fontSize: typography.metaSize,
    fontWeight: '600'
  },
  age: {
    color: colors.textMuted,
    fontSize: typography.metaSize
  },
  subject: {
    color: colors.textPrimary,
    fontSize: typography.bodySize
  },
  messages: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md
  },
  message: {
    gap: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle
  },
  route: {
    color: colors.textSecondary,
    fontSize: typography.metaSize,
    fontWeight: '600'
  },
  failure: {
    color: colors.statusRed,
    fontSize: typography.metaSize
  },
  body: {
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    lineHeight: 20
  }
})

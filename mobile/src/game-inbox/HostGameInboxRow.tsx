import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { ChevronRight, Inbox } from 'lucide-react-native'
import { Text } from '../theme/dynamic-type-text'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { colors, MIN_TOUCH_TARGET, radii, spacing, typography } from '../theme/mobile-theme'
import { openOwnerQuestionCount, readHostOwnerQuestions } from './game-owner-questions-rpc'

type Props = {
  hostId: string | undefined
  client: RpcClient | null
  connState: ConnectionState
  /** The host list's navigator, so the tablet sidebar replaces instead of stacking. */
  open: (target: string) => void
}

/** Entry to the host's owner-question Inbox; one read per focus keeps the count cheap. */
export function HostGameInboxRow({ hostId, client, connState, open }: Props) {
  const [count, setCount] = useState(0)
  const connected = connState === 'connected'

  useFocusEffect(
    useCallback(() => {
      if (!client || !connected) {
        return
      }
      let stale = false
      void readHostOwnerQuestions(client)
        .then((read) => {
          if (!stale) {
            setCount(read.status === 'ok' ? openOwnerQuestionCount(read.projects) : 0)
          }
        })
        // Why keep the last count: a failed read says nothing about the questions.
        .catch(() => {})
      return () => {
        stale = true
      }
    }, [client, connected])
  )

  if (!hostId) {
    return null
  }
  return (
    <View style={styles.section}>
      <Pressable
        style={({ pressed }) => [
          styles.row,
          pressed && styles.rowPressed,
          !connected && styles.disabled
        ]}
        onPress={() => open(`/h/${hostId}/inbox`)}
        disabled={!connected}
        accessibilityRole="button"
        accessibilityLabel={
          count > 0 ? `Inbox, ${count} question${count === 1 ? '' : 's'} waiting` : 'Inbox'
        }
      >
        <Inbox size={16} color={colors.textSecondary} />
        <Text style={styles.label}>Inbox</Text>
        {count > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeLabel}>{String(count)}</Text>
          </View>
        ) : null}
        <View style={styles.spacer} />
        <ChevronRight size={14} color={colors.textMuted} />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.row
  },
  rowPressed: {
    backgroundColor: colors.bgRaised
  },
  disabled: {
    opacity: 0.45
  },
  label: {
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    fontWeight: '500'
  },
  badge: {
    minWidth: 20,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 10,
    backgroundColor: colors.accentBlue,
    alignItems: 'center'
  },
  badgeLabel: {
    color: colors.onAccent,
    fontSize: typography.metaSize,
    fontWeight: '700'
  },
  spacer: {
    flex: 1
  }
})

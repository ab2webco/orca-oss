import { KeyRound } from 'lucide-react-native'
import { StyleSheet, View } from 'react-native'
import { Text } from '../theme/dynamic-type-text'
import { colors, radii, typography } from '../theme/mobile-theme'
import type { ClaudeTokenAccountStatus, ClaudeTokenTone } from './claude-token-account'

const TONE: Record<ClaudeTokenTone, string> = {
  positive: colors.statusGreen,
  negative: colors.statusRed,
  neutral: colors.textSecondary
}

/** The desktop's outline "Token" badge beside the account's email. */
export function ClaudeTokenBadge() {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeLabel}>Token</Text>
    </View>
  )
}

/** Under the usage bars: a token account's own status, else today's usage error. */
export function ClaudeAccountRowNotice({
  token,
  usageError
}: {
  token: ClaudeTokenAccountStatus | null
  usageError: string | null | undefined
}) {
  if (!token) {
    return usageError ? (
      <Text style={styles.error} numberOfLines={1}>
        {usageError}
      </Text>
    ) : null
  }
  // Why no usage error: it comes from the stored login, which a token launch does not use.
  return (
    <View style={styles.block}>
      <View style={styles.checkRow}>
        <KeyRound size={12} color={TONE[token.tone]} />
        <Text style={[styles.meta, token.tone === 'negative' && styles.negative]} numberOfLines={2}>
          {token.check}
        </Text>
      </View>
      <Text style={[styles.meta, token.term.soon && styles.soon]} numberOfLines={1}>
        {`${token.term.expiry} · ${token.term.saved}`}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.textMuted,
    borderRadius: radii.row,
    paddingHorizontal: 5
  },
  badgeLabel: {
    fontSize: typography.metaSize,
    fontWeight: '500',
    color: colors.textSecondary
  },
  block: {
    gap: 2
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  meta: {
    flexShrink: 1,
    fontSize: typography.metaSize,
    color: colors.textSecondary
  },
  negative: {
    color: colors.statusRed
  },
  soon: {
    color: colors.statusAmber
  },
  error: {
    fontSize: typography.metaSize,
    color: colors.statusRed
  }
})

import { StyleSheet } from 'react-native'
import { colors, spacing, typography } from '../theme/mobile-theme'
import { formatTimeAgo } from '../worktree/agent-row-display'

export const timeAgoOf = (iso: string, now: number, justNow?: string): string | null => {
  const at = Date.parse(iso)
  return Number.isNaN(at) ? null : formatTimeAgo(at, now, justNow)
}

/** The ticket, kind and age line every Inbox card on the phone starts with, and its body text. */
export const inboxMetaStyles = StyleSheet.create({
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
  age: {
    color: colors.textMuted,
    fontSize: typography.metaSize
  },
  body: {
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    lineHeight: 20
  }
})

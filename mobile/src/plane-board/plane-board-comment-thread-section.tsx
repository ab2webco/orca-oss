import { Pressable, StyleSheet, Text, View } from 'react-native'
import { MobileMarkdown } from '../components/MobileMarkdown'
import { colors, spacing, typography } from '../theme/mobile-theme'
import { formatUpdatedAt } from '../tasks/task-updated-at-time'
import type { PlaneCommentThreadState } from './use-plane-comment-thread'

type Props = {
  thread: PlaneCommentThreadState
  onRetry: () => void
}

const UNKNOWN_AUTHOR = 'Unknown author'

/** Renders what was read, and never "No comments yet" for a thread it could not read. */
export function PlaneBoardCommentThreadSection({ thread, onRetry }: Props) {
  return (
    <View style={styles.section}>
      <Text style={styles.label}>Comments</Text>
      {thread.status === 'error' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry comments"
          style={styles.row}
          onPress={onRetry}
        >
          <Text style={styles.errorText}>Could not read the comments</Text>
          <Text style={styles.rowMeta}>Retry</Text>
        </Pressable>
      ) : thread.status !== 'ready' ? (
        <Text style={styles.note}>Loading comments…</Text>
      ) : thread.comments.length === 0 ? (
        <Text style={styles.note}>No comments yet.</Text>
      ) : (
        thread.comments.map((comment) => (
          <View key={comment.id} style={styles.comment}>
            <View style={styles.commentHeader}>
              <Text style={styles.commentAuthor}>
                {comment.user?.displayName || UNKNOWN_AUTHOR}
              </Text>
              <Text style={styles.rowMeta}>{formatUpdatedAt(comment.createdAt)}</Text>
            </View>
            <View style={styles.commentBody}>
              <MobileMarkdown content={comment.body} />
            </View>
          </View>
        ))
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { marginTop: spacing.md },
  label: {
    fontSize: 11,
    color: colors.textMuted,
    paddingHorizontal: spacing.md + 2,
    marginBottom: spacing.xs
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md
  },
  rowMeta: { fontSize: typography.metaSize, color: colors.textMuted },
  note: {
    fontSize: typography.metaSize,
    color: colors.textMuted,
    paddingHorizontal: spacing.md + 2,
    paddingBottom: spacing.sm
  },
  errorText: { fontSize: typography.metaSize, color: colors.statusRed },
  comment: {
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.sm
  },
  commentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm
  },
  commentAuthor: {
    fontSize: typography.metaSize,
    color: colors.textPrimary,
    fontWeight: '700'
  },
  commentBody: { marginTop: 2 }
})

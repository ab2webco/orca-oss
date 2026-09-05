import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import { PlaneBoardWriteErrorRow } from './plane-board-write-error-row'

type Props = {
  posting: boolean
  /** The text of a post that failed earlier on this card, so it is not lost. */
  initialDraft: string
  /** Null when the failed comment belongs to another card: no retry is offered here. */
  error: string | null
  /** Resolves true once Plane has the comment; false keeps the draft on screen. */
  onPost: (body: string) => Promise<boolean>
  /** Null when the failed post must not be resent blind; the draft stays for a deliberate post. */
  onRetry: (() => Promise<boolean>) | null
  onDismissError: () => void
}

/** Mount with `key={item.id}` so the draft and the posted note belong to one card. */
export function PlaneBoardCommentComposer({
  posting,
  initialDraft,
  error,
  onPost,
  onRetry,
  onDismissError
}: Props) {
  const [draft, setDraft] = useState(initialDraft)
  const [posted, setPosted] = useState(false)
  const body = draft.trim()
  const canPost = body.length > 0 && !posting

  const post = useCallback(async () => {
    if (!canPost) {
      return
    }
    if (await onPost(body)) {
      setDraft('')
      setPosted(true)
    }
  }, [body, canPost, onPost])

  // The retry resends the failed draft, so a success must clear it here too or
  // "Post" would send the same comment twice.
  const retry = useCallback(async () => {
    if (onRetry && (await onRetry())) {
      setDraft('')
      setPosted(true)
    }
  }, [onRetry])

  return (
    <View style={styles.section}>
      <Text style={styles.label}>Comment</Text>
      <View style={styles.body}>
        <TextInput
          accessibilityLabel="Comment"
          style={styles.input}
          value={draft}
          onChangeText={(text) => {
            setDraft(text)
            setPosted(false)
            // Editing after a failure retires "Try again": it would resend the old body.
            if (error) {
              onDismissError()
            }
          }}
          placeholder="Add a comment"
          placeholderTextColor={colors.textMuted}
          multiline
          editable={!posting}
        />
        {posted ? <Text style={styles.note}>Comment posted</Text> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Post comment"
          accessibilityState={{ disabled: !canPost }}
          disabled={!canPost}
          style={[styles.button, !canPost && styles.buttonDisabled]}
          onPress={() => void post()}
        >
          <Text style={[styles.buttonText, !canPost && styles.buttonTextDisabled]}>
            {posting ? 'Posting…' : 'Post'}
          </Text>
        </Pressable>
      </View>
      {error ? (
        <PlaneBoardWriteErrorRow
          message={`Could not post the comment — ${error}`}
          onRetry={onRetry ? () => void retry() : null}
          onDismiss={onDismissError}
        />
      ) : null}
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
  body: { paddingHorizontal: spacing.md + 2, paddingBottom: spacing.md, gap: spacing.sm },
  input: {
    backgroundColor: colors.bgRaised,
    color: colors.textPrimary,
    borderRadius: radii.input,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.bodySize,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    minHeight: 72,
    textAlignVertical: 'top'
  },
  note: { fontSize: typography.metaSize, color: colors.textSecondary },
  // The one primary action in the section: bright surface, still monochrome.
  button: {
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    borderRadius: radii.button,
    backgroundColor: colors.surfaceBright
  },
  buttonDisabled: { backgroundColor: colors.bgRaised },
  buttonText: { fontSize: typography.bodySize, fontWeight: '600', color: colors.bgBase },
  buttonTextDisabled: { color: colors.textMuted }
})

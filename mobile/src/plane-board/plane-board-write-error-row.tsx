import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'

type Props = {
  message: string
  onRetry: () => void
  onDismiss: () => void
}

/** A board write Plane did not take: says so, offers the same write again. */
export function PlaneBoardWriteErrorRow({ message, onRetry, onDismiss }: Props) {
  return (
    <View style={styles.row}>
      <Pressable accessibilityRole="button" style={styles.message} onPress={onDismiss}>
        <Text style={styles.messageText}>{message}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Try again"
        style={styles.retry}
        onPress={onRetry}
      >
        <Text style={styles.retryText}>Try again</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.row,
    backgroundColor: colors.bgPanel
  },
  message: { flex: 1, minWidth: 0 },
  messageText: { fontSize: typography.metaSize, color: colors.statusRed },
  retry: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.button,
    backgroundColor: colors.bgRaised
  },
  retryText: { fontSize: typography.metaSize, color: colors.textPrimary }
})

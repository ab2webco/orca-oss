import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import { canSubmitPlaneBoardCreate, resolvePlaneBoardCreateTitle } from './plane-board-create-state'

type Props = {
  visible: boolean
  columnName: string | null
  pending: boolean
  error: string | null
  /** Resolves true once Plane has the card; false keeps the draft on screen. */
  onSubmit: (title: string) => Promise<boolean>
  onClose: () => void
}

export function PlaneBoardCreateDrawer({
  visible,
  columnName,
  pending,
  error,
  onSubmit,
  onClose
}: Props) {
  const [title, setTitle] = useState('')
  const canSubmit = canSubmitPlaneBoardCreate({ pending, error }, title)

  const submit = useCallback(async () => {
    const resolved = resolvePlaneBoardCreateTitle(title)
    if (pending || resolved === null) {
      return
    }
    if (await onSubmit(resolved)) {
      setTitle('')
      onClose()
    }
  }, [onClose, onSubmit, pending, title])

  return (
    <BottomDrawer visible={visible} onClose={onClose}>
      <View style={styles.body}>
        <Text style={styles.label}>New card</Text>
        <Text style={styles.column} numberOfLines={1}>
          {columnName ?? 'No column'}
        </Text>
        <TextInput
          accessibilityLabel="Card title"
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="Card title"
          placeholderTextColor={colors.textMuted}
          autoFocus
          editable={!pending}
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Create card"
          accessibilityState={{ disabled: !canSubmit }}
          disabled={!canSubmit}
          style={[styles.button, !canSubmit && styles.buttonDisabled]}
          onPress={() => void submit()}
        >
          <Text style={[styles.buttonText, !canSubmit && styles.buttonTextDisabled]}>
            {pending ? 'Creating…' : error ? 'Try again' : 'Create'}
          </Text>
        </Pressable>
      </View>
    </BottomDrawer>
  )
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.md + 2, paddingBottom: spacing.md, gap: spacing.sm },
  label: { fontSize: 11, color: colors.textMuted },
  column: { fontSize: typography.bodySize, fontWeight: '700', color: colors.textPrimary },
  input: {
    backgroundColor: colors.bgRaised,
    color: colors.textPrimary,
    borderRadius: radii.input,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.bodySize,
    borderWidth: 1,
    borderColor: colors.borderSubtle
  },
  error: { fontSize: typography.metaSize, color: colors.statusRed },
  // The one primary action on the sheet: bright surface, still monochrome.
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

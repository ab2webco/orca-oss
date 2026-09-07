import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { Plus } from 'lucide-react-native'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import { resolvePlaneBoardCreateTitle } from './plane-board-create-state'

type Props = {
  columnName: string
  /** Resolves true once Plane has the card; false keeps the draft on screen. */
  onCreate: (title: string) => Promise<boolean>
}

/** The inline "add card" at the foot of one column.
 *
 *  Title only: the column already fixes the state, and the rest is edited in the card's
 *  detail. Submitting is what the capture is for — seeing a gap in a column and filling it
 *  without leaving the board. */
export function PlaneBoardColumnComposer({ columnName, onCreate }: Props) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = useCallback(async () => {
    const resolved = resolvePlaneBoardCreateTitle(title)
    if (resolved === null || submitting) {
      return
    }
    setSubmitting(true)
    const created = await onCreate(resolved)
    setSubmitting(false)
    if (created) {
      // Stays open: filling a column means adding several in a row. On failure the typed
      // title is the user's work, so it survives for the retry.
      setTitle('')
    }
  }, [onCreate, submitting, title])

  const reset = useCallback(() => {
    setOpen(false)
    setTitle('')
  }, [])

  if (!open) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Add card to ${columnName}`}
        style={styles.addButton}
        onPress={() => setOpen(true)}
      >
        <Plus size={14} color={colors.textSecondary} />
        <Text style={styles.addText}>Add card</Text>
      </Pressable>
    )
  }

  return (
    <View style={styles.composer}>
      <TextInput
        accessibilityLabel={`New card in ${columnName}`}
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder="Card title"
        placeholderTextColor={colors.textMuted}
        autoFocus
        editable={!submitting}
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
      />
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Create card"
          style={styles.create}
          disabled={submitting || resolvePlaneBoardCreateTitle(title) === null}
          onPress={() => void submit()}
        >
          <Text style={styles.createText}>{submitting ? 'Creating…' : 'Add'}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel card"
          style={styles.cancel}
          disabled={submitting}
          onPress={reset}
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.sm,
    margin: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.button,
    backgroundColor: colors.bgPanel
  },
  addText: { fontSize: typography.metaSize, color: colors.textSecondary },
  composer: { margin: spacing.sm, gap: spacing.sm },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  create: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.button,
    backgroundColor: colors.bgRaised
  },
  createText: { fontSize: typography.metaSize, color: colors.textPrimary },
  cancel: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  cancelText: { fontSize: typography.metaSize, color: colors.textSecondary },
  input: {
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.button,
    backgroundColor: colors.bgBase,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.metaSize,
    color: colors.textPrimary
  }
})

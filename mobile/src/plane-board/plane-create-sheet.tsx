import { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { ChevronDown } from 'lucide-react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { TaskProviderLogo } from '../components/TaskProviderLogo'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import { resolvePlaneBoardCreateTitle } from './plane-board-create-state'
import type { PlaneWriteFailure } from './plane-write-failure'

type Props = {
  visible: boolean
  projectLabel: string
  onPickProject: () => void
  onClose: () => void
  /** Resolves ok once Plane has the card; the parent closes the sheet then. */
  onCreate: (title: string) => Promise<{ ok: true } | PlaneWriteFailure>
}

/** The header `+` sheet: project and title, nothing else. The detail edits the rest. */
export function PlaneCreateSheet({
  visible,
  projectLabel,
  onPickProject,
  onClose,
  onCreate
}: Props) {
  const [title, setTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(async () => {
    const resolved = resolvePlaneBoardCreateTitle(title)
    if (resolved === null || creating) {
      return
    }
    setCreating(true)
    setError(null)
    const result = await onCreate(resolved)
    setCreating(false)
    // On failure the typed title is the user's work, so it survives for the retry.
    if (result.ok) {
      setTitle('')
    } else {
      setError(result.error)
    }
  }, [creating, onCreate, title])

  // Every way out resets the draft, so the next open never shows the previous title —
  // an effect on `visible` would paint it for a frame first.
  const leave = useCallback((then: () => void) => {
    setTitle('')
    setError(null)
    then()
  }, [])

  const disabled = creating || resolvePlaneBoardCreateTitle(title) === null

  return (
    <BottomDrawer visible={visible} onClose={() => leave(onClose)}>
      <View style={styles.sheetHeader}>
        <View style={styles.sheetTitleRow}>
          <TaskProviderLogo provider="plane" size={16} color={colors.textPrimary} />
          <Text style={styles.sheetTitle}>New Plane Work Item</Text>
        </View>
        <Text style={styles.sheetSubtitle}>
          Create a work item in the selected project. Fill in the rest on the card.
        </Text>
      </View>
      <View style={styles.createForm}>
        <Text style={styles.fieldLabel}>Project</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Pick project"
          style={styles.targetButton}
          disabled={creating}
          onPress={() => leave(onPickProject)}
        >
          <Text style={styles.targetButtonText} numberOfLines={1}>
            {projectLabel}
          </Text>
          <ChevronDown size={14} color={colors.textMuted} />
        </Pressable>
        <TextInput
          accessibilityLabel="Work item title"
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="Title"
          placeholderTextColor={colors.textMuted}
          editable={!creating}
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
        />
        {error ? (
          <Text accessibilityLabel="Create error" style={styles.errorText}>
            {error}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Create work item"
          style={[styles.createButton, disabled && styles.createButtonDisabled]}
          disabled={disabled}
          onPress={() => void submit()}
        >
          {creating ? (
            <ActivityIndicator size="small" color={colors.bgBase} />
          ) : (
            <Text style={styles.createButtonText}>Create</Text>
          )}
        </Pressable>
      </View>
    </BottomDrawer>
  )
}

const styles = StyleSheet.create({
  sheetHeader: { paddingHorizontal: spacing.xs, marginBottom: spacing.md },
  sheetTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sheetTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
    lineHeight: 20
  },
  sheetSubtitle: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  createForm: { gap: spacing.sm },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  targetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgPanel,
    borderRadius: radii.input,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2
  },
  targetButtonText: { flex: 1, color: colors.textPrimary, fontSize: typography.bodySize },
  input: {
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgPanel,
    borderRadius: radii.input,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
    fontSize: typography.bodySize
  },
  errorText: { fontSize: typography.metaSize, color: colors.statusRed },
  createButton: {
    marginTop: spacing.sm,
    backgroundColor: colors.textPrimary,
    borderRadius: radii.button,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center'
  },
  createButtonDisabled: { opacity: 0.5 },
  createButtonText: { color: colors.bgBase, fontSize: typography.bodySize, fontWeight: '700' }
})

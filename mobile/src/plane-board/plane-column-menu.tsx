import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { MoreHorizontal, Pencil } from 'lucide-react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'

type Props = {
  name: string
  editing: boolean
  /** The board's last column write failure, shown inline only after this drawer's own attempt. */
  error: string | null
  onRename: (name: string) => Promise<boolean>
}

// Why: the drawer stacks above the board's other sheets, the way the assignee picker does.
const MENU_Z_INDEX = 1100

/** The per-column "…" under a column title: opens the column's actions. */
export function PlaneColumnMenu({ name, editing, error, onRename }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Column actions for ${name}`}
        style={styles.trigger}
        onPress={() => setOpen(true)}
      >
        <MoreHorizontal size={16} color={colors.textSecondary} />
      </Pressable>
      <BottomDrawer
        visible={open}
        onClose={() => setOpen(false)}
        contentScrollable={false}
        zIndex={MENU_Z_INDEX}
      >
        <MenuContent
          name={name}
          editing={editing}
          error={error}
          onRename={onRename}
          onClose={() => setOpen(false)}
        />
      </BottomDrawer>
    </>
  )
}

type ContentProps = Props & { onClose: () => void }

// Why: the drawer unmounts its children when hidden, so mode, draft and the failed flag
// reset on every open without an effect.
function MenuContent({ name, editing, error, onRename, onClose }: ContentProps) {
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(name)
  const [failed, setFailed] = useState(false)
  const inlineError = failed ? error : null
  const trimmed = draft.trim()
  const saveDisabled = editing || trimmed === '' || trimmed === name

  const save = async (): Promise<void> => {
    if (saveDisabled) {
      return
    }
    setFailed(false)
    const renamed = await onRename(trimmed)
    if (renamed) {
      onClose()
    } else {
      setFailed(true)
    }
  }

  return (
    <View style={styles.content}>
      <Text style={styles.title} numberOfLines={1}>
        {name}
      </Text>
      {renaming ? (
        <>
          <TextInput
            accessibilityLabel="Column name"
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Column name"
            placeholderTextColor={colors.textMuted}
            autoFocus
            editable={!editing}
            returnKeyType="done"
            onSubmitEditing={() => void save()}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save column name"
            style={[styles.save, saveDisabled && styles.disabled]}
            disabled={saveDisabled}
            onPress={() => void save()}
          >
            <Text style={styles.saveText}>{editing ? 'Saving…' : 'Save'}</Text>
          </Pressable>
        </>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Rename column"
          style={styles.row}
          onPress={() => setRenaming(true)}
        >
          <Pencil size={16} color={colors.textPrimary} />
          <Text style={styles.rowText}>Rename column</Text>
        </Pressable>
      )}
      {inlineError ? (
        <Text accessibilityLabel="Column error" style={styles.error}>
          {inlineError}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  trigger: { alignSelf: 'flex-end', paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  content: { gap: spacing.md, paddingHorizontal: spacing.xs },
  title: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, lineHeight: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.sm + 2,
    borderRadius: 12,
    backgroundColor: colors.bgPanel
  },
  rowText: { fontSize: typography.bodySize, color: colors.textPrimary },
  input: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radii.input,
    backgroundColor: colors.bgPanel,
    fontSize: typography.bodySize,
    color: colors.textPrimary
  },
  save: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.button,
    backgroundColor: colors.bgRaised
  },
  disabled: { opacity: 0.5 },
  saveText: { fontSize: typography.bodySize, color: colors.textPrimary },
  error: { fontSize: typography.metaSize, color: colors.statusRed }
})

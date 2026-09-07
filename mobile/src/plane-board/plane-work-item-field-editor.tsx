import { useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import type { PlaneMobileWorkItem } from '../tasks/plane-mobile-work-item-read'
import {
  resolvePlaneDateSave,
  resolvePlaneLabelsSave,
  resolvePlaneTitleSave,
  shouldSavePlaneDescription
} from './plane-work-item-field-drafts'
import type { PlaneWorkItemFieldEdit } from './use-plane-board-edits'

type Props = {
  item: PlaneMobileWorkItem
  /** A write on this card is in flight: the fields wait for it. */
  editing: boolean
  clearable: boolean
  onSave: (edit: PlaneWorkItemFieldEdit) => void
}

type FieldSave = { edit: PlaneWorkItemFieldEdit } | { error: string } | null

/** The in-place text and date fields of the detail sheet. Each one saves when
 *  it is left or submitted, and shows what the card shows — so an optimistic
 *  edit, its rollback and a re-read all land here through `item`. */
export function PlaneWorkItemFieldEditor({ item, editing, clearable, onSave }: Props) {
  const dateField = (field: 'startDate' | 'targetDate') => (draft: string) => {
    const save = resolvePlaneDateSave({ draft, stored: item[field], clearable })
    return save && 'value' in save ? { edit: { [field]: save.value } } : save
  }
  return (
    <View style={styles.section}>
      <DraftField
        label="Title"
        stored={item.title}
        editing={editing}
        onSave={onSave}
        resolve={(draft) => {
          const save = resolvePlaneTitleSave({ draft, stored: item.title })
          return save && { edit: save }
        }}
      />
      <DraftField
        label="Description"
        stored={item.description ?? ''}
        placeholder="Add a description"
        multiline
        editing={editing}
        onSave={onSave}
        resolve={(draft) =>
          shouldSavePlaneDescription({ draft, stored: item.description })
            ? { edit: { description: draft } }
            : null
        }
      />
      <DraftField
        label="Labels"
        stored={(item.labelIds ?? []).join(', ')}
        placeholder="Label ids, comma-separated"
        editing={editing}
        onSave={onSave}
        resolve={(draft) => {
          const save = resolvePlaneLabelsSave({ draft, stored: item.labelIds })
          return save && { edit: save }
        }}
      />
      <DraftField
        label="Start date"
        stored={item.startDate ?? ''}
        placeholder="YYYY-MM-DD"
        editing={editing}
        onSave={onSave}
        resolve={dateField('startDate')}
      />
      <DraftField
        label="Target date"
        stored={item.targetDate ?? ''}
        placeholder="YYYY-MM-DD"
        editing={editing}
        onSave={onSave}
        resolve={dateField('targetDate')}
      />
    </View>
  )
}

type FieldProps = {
  label: string
  stored: string
  placeholder?: string
  multiline?: boolean
  editing: boolean
  onSave: (edit: PlaneWorkItemFieldEdit) => void
  resolve: (draft: string) => FieldSave
}

function DraftField({
  label,
  stored,
  placeholder,
  multiline,
  editing,
  onSave,
  resolve
}: FieldProps) {
  return (
    <DraftInput
      // Remount on a stored change: a save, its rollback or a re-read re-seeds the draft.
      key={stored}
      label={label}
      stored={stored}
      placeholder={placeholder}
      multiline={multiline}
      editing={editing}
      onSave={onSave}
      resolve={resolve}
    />
  )
}

function DraftInput({
  label,
  stored,
  placeholder,
  multiline,
  editing,
  onSave,
  resolve
}: FieldProps) {
  const [draft, setDraft] = useState(stored)
  const [error, setError] = useState<string | null>(null)
  const commit = () => {
    const save = resolve(draft)
    if (save === null) {
      // Unchanged, or discarded (an empty title): the field shows the card again.
      setDraft(stored)
      setError(null)
      return
    }
    if ('error' in save) {
      setError(save.error)
      return
    }
    setError(null)
    onSave(save.edit)
  }
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        style={[styles.input, multiline && styles.multiline]}
        value={draft}
        onChangeText={(text) => {
          setDraft(text)
          setError(null)
        }}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        multiline={multiline}
        editable={!editing}
        returnKeyType={multiline ? undefined : 'done'}
        onSubmitEditing={multiline ? undefined : commit}
        onBlur={commit}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { marginTop: spacing.md, paddingHorizontal: spacing.md + 2, gap: spacing.sm },
  field: { gap: spacing.xs },
  label: { fontSize: 11, color: colors.textMuted },
  input: {
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.input,
    backgroundColor: colors.bgBase,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.bodySize,
    color: colors.textPrimary
  },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  errorText: { fontSize: typography.metaSize, color: colors.statusRed }
})

import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { Check } from 'lucide-react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import type { PlaneMobileMember } from '../tasks/plane-mobile-work-item-read'
import { memberInitials, planeAssigneeOptions } from './plane-assignee-picker-options'

type Props = {
  visible: boolean
  onClose: () => void
  members: readonly PlaneMobileMember[]
  /** The card's live assignees, so a toggled row flips as the optimistic edit lands. */
  assignees: readonly PlaneMobileMember[]
  /** True while a write on the card is in flight. */
  disabled: boolean
  onToggle: (member: PlaneMobileMember) => void
}

// Why: the detail sheet is a BottomDrawer at its default zIndex; this one stacks above it.
const PICKER_Z_INDEX = 1100

/** Multi-select stays open across toggles; closing the drawer is "done". */
export function PlaneAssigneePickerSheet({
  visible,
  onClose,
  members,
  assignees,
  disabled,
  onToggle
}: Props) {
  return (
    <BottomDrawer
      visible={visible}
      onClose={onClose}
      contentScrollable={false}
      zIndex={PICKER_Z_INDEX}
    >
      <PickerContent
        members={members}
        assignees={assignees}
        disabled={disabled}
        onToggle={onToggle}
      />
    </BottomDrawer>
  )
}

type ContentProps = Pick<Props, 'members' | 'assignees' | 'disabled' | 'onToggle'>

// Why: the drawer unmounts its children when hidden, so the query resets on every open.
function PickerContent({ members, assignees, disabled, onToggle }: ContentProps) {
  const [query, setQuery] = useState('')
  const options = planeAssigneeOptions(members, assignees, query)
  return (
    <>
      <View style={styles.header}>
        <Text style={styles.title}>Assignees</Text>
      </View>
      <TextInput
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        accessibilityLabel="Search members"
        placeholder="Search members"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {options.length === 0 ? (
        <Text style={styles.note}>No members match</Text>
      ) : (
        <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
          <View style={styles.group}>
            {options.map(({ member, name, assigned }, index) => (
              <View key={member.id}>
                {index > 0 ? <View style={styles.separator} /> : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${assigned ? 'Unassign' : 'Assign'} ${name}`}
                  aria-checked={assigned}
                  disabled={disabled}
                  style={styles.row}
                  onPress={() => onToggle(member)}
                >
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{memberInitials(member.displayName)}</Text>
                  </View>
                  <View style={styles.textWrap}>
                    <Text style={[styles.name, assigned && styles.nameAssigned]} numberOfLines={1}>
                      {name}
                    </Text>
                  </View>
                  {assigned ? <Check size={15} color={colors.textPrimary} /> : null}
                </Pressable>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </>
  )
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.xs, marginBottom: spacing.md },
  title: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, lineHeight: 20 },
  search: {
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radii.input,
    backgroundColor: colors.bgPanel,
    fontSize: typography.bodySize,
    color: colors.textPrimary
  },
  // Why: the sheet must keep a bounded height with 20+ members; the rows scroll, not the sheet.
  list: { maxHeight: 360 },
  group: { backgroundColor: colors.bgPanel, borderRadius: 12, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.sm + 2
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgRaised
  },
  avatarText: { fontSize: 11, fontWeight: '700', color: colors.textSecondary },
  textWrap: { flex: 1, minWidth: 0 },
  name: { fontSize: typography.bodySize, color: colors.textPrimary },
  nameAssigned: { fontWeight: '700' },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderSubtle,
    marginHorizontal: spacing.md
  },
  note: {
    fontSize: typography.metaSize,
    color: colors.textMuted,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.md
  }
})

import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { ChevronRight, Crown, Users } from 'lucide-react-native'
import { TextInputModal } from '../components/TextInputModal'
import { Text } from '../theme/dynamic-type-text'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import { leadNameRowOf, memberNamesFromInput, memberNamesRowOf } from './agent-teams-names-model'
import type { AgentTeamsNamesState } from './use-agent-teams-names'

type Props = {
  state: AgentTeamsNamesState
  hostName: string
  onLeadName: (name: string | null) => void
  onMemberNames: (names: string[] | null) => void
}

/** Settings → Agent Teams → Names: where the names come from, and this computer's own (ORCA-1304). */
export function AgentTeamsNamesSection({ state, hostName, onLeadName, onMemberNames }: Props) {
  const [open, setOpen] = useState<string | null>(null)
  const heading = <Text style={styles.sectionHeading}>Names</Text>
  if (state.kind !== 'ready') {
    const why = state.kind === 'failed' ? `Could not read the names: ${state.message}` : null
    return state.kind === 'loading' ? null : (
      <>
        {heading}
        <Text style={styles.intro}>
          {why ?? `Update Orca on ${hostName || 'this computer'} to name the team here`}
        </Text>
      </>
    )
  }
  const { names } = state
  const fields = [
    {
      icon: Crown,
      label: 'Lead name',
      row: leadNameRowOf(names),
      hint: 'Leave it empty and the lead is called Lead.',
      value: names.leadName ?? '',
      placeholder: 'Lead',
      submit: (value: string) => onLeadName(value || null)
    },
    {
      icon: Users,
      label: 'Member names',
      row: memberNamesRowOf(names),
      hint: "Separate names with commas. Leave it empty to use the scene's names.",
      value: names.memberNames?.join(', ') ?? '',
      placeholder: names.sceneRoster?.slice(0, 3).join(', ') ?? 'Ada, Bo, Cy',
      submit: (value: string) => onMemberNames(memberNamesFromInput(value))
    }
  ]
  const editing = fields.find((field) => field.label === open)
  return (
    <>
      {heading}
      <Text style={styles.intro}>
        Each member takes the next free name from the scene. The lead is called Lead until you name
        it.
      </Text>
      {state.saveError ? <Text style={styles.error}>{state.saveError}</Text> : null}
      <View style={styles.card}>
        {fields.map((field, index) => (
          <View key={field.label}>
            {index > 0 ? <View style={styles.separator} /> : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={field.label}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => setOpen(field.label)}
            >
              <field.icon size={16} color={colors.textSecondary} />
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>{field.label}</Text>
                <Text style={styles.rowValue} numberOfLines={2}>
                  {field.row.value}
                </Text>
                <Text style={styles.source}>{field.row.source}</Text>
              </View>
              <ChevronRight size={16} color={colors.textMuted} />
            </Pressable>
          </View>
        ))}
      </View>
      <TextInputModal
        visible={editing !== undefined}
        title={editing?.label ?? ''}
        message={editing?.hint}
        defaultValue={editing?.value ?? ''}
        placeholder={editing?.placeholder}
        allowEmpty
        onSubmit={(value) => {
          editing?.submit(value)
          setOpen(null)
        }}
        onCancel={() => setOpen(null)}
      />
    </>
  )
}

const styles = StyleSheet.create({
  sectionHeading: {
    marginTop: spacing.xl,
    paddingBottom: spacing.xs,
    fontSize: typography.metaSize,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5
  },
  intro: { paddingBottom: spacing.sm, fontSize: typography.metaSize, color: colors.textMuted },
  error: { paddingBottom: spacing.sm, fontSize: typography.metaSize, color: colors.statusRed },
  card: { backgroundColor: colors.bgPanel, borderRadius: radii.card, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md + 2
  },
  rowPressed: { backgroundColor: colors.bgRaised },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontSize: typography.bodySize, color: colors.textPrimary },
  rowValue: { fontSize: typography.bodySize, color: colors.textSecondary },
  source: { fontSize: typography.metaSize, color: colors.textMuted },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderSubtle,
    marginLeft: spacing.md + 2
  }
})

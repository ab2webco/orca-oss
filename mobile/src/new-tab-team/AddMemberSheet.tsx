import { useState, type ReactNode } from 'react'
import { Check, ChevronDown, Monitor } from 'lucide-react-native'
import { Pressable, StyleSheet, View } from 'react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { Text } from '../theme/dynamic-type-text'
import { colors, radii, spacing } from '../theme/mobile-theme'
import type { AddMemberHost, AddMemberRoster } from './add-member-options'
import type { AddMemberChoice } from './add-member-send'

type Props = {
  visible: boolean
  /** The lead's desktop, named for the host whose `on` is null. */
  hostName: string
  roster: AddMemberRoster
  onSend: (choice: AddMemberChoice) => void
  onClose: () => void
}

const agentsOf = (host: AddMemberHost): string =>
  host.cap === null ? `${host.running} agents` : `${host.running} of ${host.cap} agents`

function Field(props: {
  icon?: ReactNode
  value: string
  meta: string | null
  onPress: () => void
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.field, pressed && styles.pressed]}
      onPress={props.onPress}
    >
      {props.icon}
      <Text style={styles.value} numberOfLines={1}>
        {props.value}
      </Text>
      {props.meta ? <Text style={styles.meta}>{props.meta}</Text> : null}
      <ChevronDown size={16} color={colors.textMuted} />
    </Pressable>
  )
}

// Why a check and weight: the repo's PickerModal marks the current choice this way.
function Option(props: {
  value: string
  meta: string | null
  selected: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityState={{ selected: props.selected }}
      style={({ pressed }) => [styles.option, pressed && styles.pressed]}
      onPress={props.onPress}
    >
      <Text style={[styles.value, props.selected && styles.valueSelected]} numberOfLines={1}>
        {props.value}
      </Text>
      {props.meta ? <Text style={styles.meta}>{props.meta}</Text> : null}
      <View style={styles.check}>
        {props.selected ? <Check size={16} color={colors.textPrimary} /> : null}
      </View>
    </Pressable>
  )
}

/** p03 Add member: one ticket per launch, on the picked host; the lead's host picks the account (ORCA-1183). */
export function AddMemberSheet({ visible, hostName, roster, onSend, onClose }: Props) {
  const [host, setHost] = useState<AddMemberHost | null>(null)
  const [ticketId, setTicketId] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [shown, setShown] = useState(visible)
  // Why during render: each opening starts with no ticket picked, without a frame of the last one.
  if (shown !== visible) {
    setShown(visible)
    if (visible) {
      setTicketId(null)
      setOpen(false)
    }
  }

  const runOn = host ?? roster.hosts[0]
  const ticket = roster.todo.find((one) => one.identifier === ticketId) ?? null
  const hostLabel = (one: AddMemberHost): string => one.on ?? hostName

  return (
    <BottomDrawer visible={visible} onClose={onClose}>
      <Text style={styles.title}>Add member</Text>
      <View style={styles.block}>
        <Text style={styles.label}>Run on</Text>
        <Field
          icon={<Monitor size={16} color={colors.textSecondary} />}
          value={hostLabel(runOn)}
          meta={agentsOf(runOn)}
          onPress={() => setOpen(!open)}
        />
        {open
          ? roster.hosts.map((one) => (
              <Option
                key={one.on ?? ''}
                value={hostLabel(one)}
                meta={agentsOf(one)}
                selected={one.on === runOn.on}
                onPress={() => {
                  setHost(one)
                  setOpen(false)
                }}
              />
            ))
          : null}
      </View>
      <View style={styles.block}>
        <Text style={styles.label}>To Do</Text>
        <View style={styles.list}>
          {roster.todo.map((one, index) => {
            const picked = one.identifier === ticketId
            return (
              <Pressable
                key={one.identifier}
                accessibilityState={{ selected: picked }}
                style={({ pressed }) => [
                  styles.ticket,
                  index > 0 && styles.separator,
                  picked && styles.selected,
                  pressed && styles.pressed
                ]}
                onPress={() => setTicketId(one.identifier)}
              >
                <Text style={styles.ticketId}>{one.identifier}</Text>
                <Text style={[styles.value, picked && styles.valueSelected]} numberOfLines={1}>
                  {one.title}
                </Text>
                <View style={styles.check}>
                  {picked ? <Check size={16} color={colors.textPrimary} /> : null}
                </View>
              </Pressable>
            )
          })}
        </View>
      </View>
      <Pressable
        disabled={!ticket}
        style={[styles.primary, !ticket && styles.primaryDisabled]}
        onPress={() => ticket && onSend({ ticket, accountId: null, on: runOn.on })}
      >
        <Text style={styles.primaryText}>Add member</Text>
      </Pressable>
    </BottomDrawer>
  )
}

const styles = StyleSheet.create({
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.sm
  },
  block: { marginBottom: spacing.md, gap: spacing.xs },
  label: { fontSize: 13, color: colors.textSecondary, paddingHorizontal: spacing.xs },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radii.input,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgPanel
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    marginLeft: spacing.md
  },
  value: { flex: 1, minWidth: 0, fontSize: 15, color: colors.textPrimary },
  valueSelected: { fontWeight: '600' },
  meta: { fontSize: 12, color: colors.textMuted },
  check: { width: 16, alignItems: 'center' },
  list: { borderRadius: radii.input, backgroundColor: colors.bgPanel, overflow: 'hidden' },
  ticket: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md
  },
  ticketId: { fontSize: 12, fontFamily: 'monospace', color: colors.textMuted },
  separator: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderSubtle },
  selected: { backgroundColor: colors.bgRaised },
  pressed: { backgroundColor: colors.bgRaised },
  primary: {
    alignSelf: 'flex-end',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radii.button,
    backgroundColor: colors.surfaceBright
  },
  primaryDisabled: { opacity: 0.4 },
  primaryText: { fontSize: 15, fontWeight: '600', color: colors.bgBase }
})

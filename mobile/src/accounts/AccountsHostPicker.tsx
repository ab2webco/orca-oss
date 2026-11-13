import { Check, Monitor } from 'lucide-react-native'
import { Pressable, StyleSheet, View } from 'react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { Text } from '../theme/dynamic-type-text'
import { colors, radii, spacing } from '../theme/mobile-theme'
import type { AccountsHostPickerRow } from './accounts-host-picker-rows'

const TONE_COLOR: Record<AccountsHostPickerRow['tone'], string> = {
  green: colors.statusGreen,
  amber: colors.statusAmber,
  red: colors.statusRed,
  muted: colors.textMuted
}

/** The "Accounts on" sheet: pick which paired desktop's accounts the screen shows. */
export function AccountsHostPicker(props: {
  visible: boolean
  rows: readonly AccountsHostPickerRow[]
  onPick: (hostId: string) => void
  onClose: () => void
}) {
  return (
    <BottomDrawer visible={props.visible} onClose={props.onClose}>
      <Text style={styles.title}>Accounts on</Text>
      <View style={styles.group}>
        {props.rows.map((row, index) => (
          <Pressable
            key={row.id}
            style={({ pressed }) => [
              styles.row,
              index > 0 && styles.separator,
              pressed && styles.rowPressed
            ]}
            onPress={() => props.onPick(row.id)}
          >
            <Monitor size={18} color={colors.textSecondary} />
            <View style={styles.main}>
              <Text style={styles.name} numberOfLines={1}>
                {row.name}
              </Text>
              <View style={styles.meta}>
                <View style={[styles.dot, { backgroundColor: TONE_COLOR[row.tone] }]} />
                <Text style={styles.status} numberOfLines={1}>
                  {row.status}
                </Text>
              </View>
            </View>
            {row.current ? <Check size={18} color={colors.accentBlue} /> : null}
          </Pressable>
        ))}
      </View>
    </BottomDrawer>
  )
}

const styles = StyleSheet.create({
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md
  },
  group: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.lg,
    borderRadius: radii.card,
    backgroundColor: colors.bgRaised,
    overflow: 'hidden'
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md
  },
  separator: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderSubtle },
  rowPressed: { backgroundColor: colors.bgPanel },
  main: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  status: { flexShrink: 1, fontSize: 12, color: colors.textSecondary }
})

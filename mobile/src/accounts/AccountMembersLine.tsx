import { Users } from 'lucide-react-native'
import { StyleSheet, View } from 'react-native'
import { Text } from '../theme/dynamic-type-text'
import { colors, spacing } from '../theme/mobile-theme'

/** Who runs on one account, "Lead, Merlín, Arquera"; nothing when nobody does. */
export function AccountMembersLine({ names }: { names: readonly string[] }) {
  if (names.length === 0) {
    return null
  }
  return (
    <View style={styles.row}>
      <Users size={12} color={colors.textMuted} style={styles.icon} />
      <Text style={styles.text}>{names.join(', ')}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: spacing.sm },
  icon: { marginTop: 2 },
  text: { flex: 1, fontSize: 12, color: colors.textSecondary }
})

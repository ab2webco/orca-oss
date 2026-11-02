import { Pressable, StyleSheet, View } from 'react-native'
import { Users } from 'lucide-react-native'
import { Text } from '../theme/dynamic-type-text'
import { colors, typography } from '../theme/mobile-theme'
import { styles as frame } from '../session/mobile-session-styles'
import { teamButtonLabel, type TeamBadge } from './team-drawer-model'

export function TeamHeaderButton({ badge, onPress }: { badge: TeamBadge; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [frame.filesButton, pressed && frame.filesButtonPressed]}
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={teamButtonLabel(badge)}
    >
      <Users size={18} color={colors.textSecondary} strokeWidth={2.1} />
      {badge ? (
        <View style={[styles.badge, badge.tone === 'question' ? styles.question : styles.working]}>
          <Text style={styles.badgeLabel}>{String(badge.count)}</Text>
        </View>
      ) : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center'
  },
  question: {
    backgroundColor: colors.statusRed
  },
  working: {
    backgroundColor: colors.accentBlue
  },
  badgeLabel: {
    color: colors.onAccent,
    fontSize: typography.metaSize - 2,
    fontWeight: '700'
  }
})

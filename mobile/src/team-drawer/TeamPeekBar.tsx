import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '../theme/dynamic-type-text'
import { colors, spacing, typography } from '../theme/mobile-theme'
import type { TeamPeek } from './team-drawer-model'
import type { TeamCardWords } from './team-card-words'

/** V30's collapsed sheet height. */
export const TEAM_PEEK_HEIGHT = 60

export function PeekBar({
  peek,
  open,
  words,
  onPress
}: {
  peek: TeamPeek
  open: boolean
  words: TeamCardWords
  onPress: () => void
}) {
  const tone = { question: colors.statusRed, working: colors.statusGreen, idle: colors.textMuted }[
    peek.tone
  ]
  return (
    <Pressable
      style={styles.peek}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={open ? words.closeTeam(peek.text) : words.openTeam(peek.text)}
      aria-expanded={open}
    >
      <View style={styles.grab} />
      <View style={styles.peekLine}>
        <View style={[styles.dot, { backgroundColor: tone }]} />
        <Text
          style={[styles.peekText, peek.tone === 'question' && { color: tone }]}
          numberOfLines={1}
        >
          {peek.text}
        </Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  peek: {
    height: TEAM_PEEK_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7
  },
  grab: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.textMuted
  },
  peekLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: spacing.lg
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4
  },
  peekText: {
    color: colors.textSecondary,
    fontSize: typography.metaSize + 1
  }
})

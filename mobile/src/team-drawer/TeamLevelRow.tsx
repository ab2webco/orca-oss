import { StyleSheet, View } from 'react-native'
import type { GameCharacterLevel } from '../../../src/shared/orchestrator-game-characters'
import { Text } from '../theme/dynamic-type-text'
import { colors, spacing, typography } from '../theme/mobile-theme'
import type { TeamCardWords } from './team-card-words'

// Why the game's curve: the level is what the characters earned, as the desktop panel shows it (ORCA-1094).
export function TeamLevelRow({
  level,
  words
}: {
  level: GameCharacterLevel
  words: TeamCardWords
}) {
  const label = words.level(level.level)
  const progress = words.xpProgress(level.into, level.need)
  const fill = level.need > 0 ? Math.min(100, Math.round((level.into / level.need) * 100)) : 0
  return (
    <View style={styles.level} accessible accessibilityLabel={`${label}, ${progress}`}>
      <Text style={styles.levelText}>{label}</Text>
      <View style={styles.levelTrack}>
        <View style={[styles.levelFill, { width: `${fill}%` }]} />
      </View>
      <Text style={styles.levelText}>{progress}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  level: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.sm
  },
  levelText: {
    color: colors.textSecondary,
    fontFamily: typography.monoFamily,
    fontSize: typography.metaSize
  },
  levelTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderSubtle,
    overflow: 'hidden'
  },
  levelFill: {
    height: 4,
    backgroundColor: colors.textSecondary
  }
})

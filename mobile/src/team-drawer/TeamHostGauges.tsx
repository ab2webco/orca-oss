import type { LucideIcon } from 'lucide-react-native'
import { StyleSheet, View } from 'react-native'
import { Text } from '../theme/dynamic-type-text'
import { colors, spacing, typography } from '../theme/mobile-theme'
import { useTeamTones } from './team-status-tone'
import type { TeamWorkWords } from './team-work-words'

/** A share in use; null is a figure the host did not send, drawn dashed so it never reads as 0%. */
export function Meter({
  label,
  percent,
  warn,
  words
}: {
  label: string
  percent: number | null
  warn: boolean
  words: TeamWorkWords
}) {
  const tones = useTeamTones()
  if (percent === null) {
    return <View style={[styles.track, styles.unknown]} />
  }
  return (
    <View accessibilityLabel={words.used(label, percent)} style={styles.track}>
      <View
        style={[
          styles.fill,
          { width: `${percent}%`, backgroundColor: warn ? tones.warning : colors.textMuted }
        ]}
      />
    </View>
  )
}

/** A collapsed card's thin bar: its name, its percent, and the bar. */
export function Gauge({
  label,
  percent,
  warn,
  words
}: {
  label: string
  percent: number | null
  warn: boolean
  words: TeamWorkWords
}) {
  const tones = useTeamTones()
  return (
    <View style={styles.gauge}>
      <View style={styles.gaugeLine}>
        <Text style={styles.label}>{label}</Text>
        <Text style={[styles.percent, warn && { color: tones.warning }]}>
          {percent === null ? '—' : `${percent}%`}
        </Text>
      </View>
      <Meter label={label} percent={percent} warn={warn} words={words} />
    </View>
  )
}

/** An open card's readout: the big percent, the bar, and what it is made of. */
export function Readout({
  icon: Icon,
  label,
  percent,
  warn,
  caption,
  first,
  words
}: {
  icon: LucideIcon
  label: string
  percent: number | null
  warn: boolean
  caption: string | null
  first: boolean
  words: TeamWorkWords
}) {
  const tones = useTeamTones()
  return (
    <View style={[styles.readout, !first && styles.divided]}>
      <View style={styles.labelLine}>
        <Icon size={12} color={colors.textSecondary} />
        <Text style={styles.label}>{label}</Text>
      </View>
      <Text style={[percent === null ? styles.side : styles.big, warn && { color: tones.warning }]}>
        {percent === null ? words.launch.unknown : `${percent}%`}
      </Text>
      <Meter label={label} percent={percent} warn={warn} words={words} />
      {caption ? <Text style={styles.side}>{caption}</Text> : null}
    </View>
  )
}

export const gaugeStyles = StyleSheet.create({
  label: {
    color: colors.textSecondary,
    fontSize: typography.metaSize - 1,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase'
  },
  big: {
    color: colors.textPrimary,
    fontSize: typography.titleSize,
    fontWeight: '600'
  },
  side: {
    color: colors.textSecondary,
    fontSize: typography.metaSize
  },
  divided: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.borderSubtle,
    paddingLeft: spacing.sm
  }
})

const styles = StyleSheet.create({
  ...gaugeStyles,
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderSubtle,
    overflow: 'hidden'
  },
  unknown: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderSubtle
  },
  fill: {
    height: 4
  },
  gauge: {
    flex: 1,
    gap: spacing.xs
  },
  gaugeLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs
  },
  labelLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs
  },
  percent: {
    color: colors.textPrimary,
    fontSize: typography.metaSize,
    fontWeight: '600'
  },
  readout: {
    flex: 1,
    gap: spacing.xs,
    paddingRight: spacing.sm
  }
})

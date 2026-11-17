import { Bot, Server, TriangleAlert, type LucideIcon } from 'lucide-react-native'
import { StyleSheet, View } from 'react-native'
import {
  teamMachinesSummaryOf,
  teamMachineWarningsOf
} from '../../../src/shared/team-machine-board'
import type { TeamMachine } from '../../../src/shared/team-panel-model-types'
import { Text } from '../theme/dynamic-type-text'
import { colors, radii, spacing } from '../theme/mobile-theme'
import { gaugeStyles, Meter } from './TeamHostGauges'
import { useTeamTones } from './team-status-tone'
import type { TeamWorkWords } from './team-work-words'

type Segment = 'on' | 'off' | 'warning' | 'none'

/** One segment per host, so the strip shows which share of the fleet a figure is. */
function Segments({ of }: { of: Segment[] }) {
  const tones = useTeamTones()
  return (
    <View style={styles.segments}>
      {of.map((one, index) => (
        <View
          key={index}
          style={[
            styles.segment,
            one === 'on' && { backgroundColor: colors.textMuted },
            one === 'warning' && { backgroundColor: tones.warning },
            one === 'off' && styles.off
          ]}
        />
      ))}
    </View>
  )
}

function Figure({
  icon: Icon,
  label,
  value,
  total,
  warn = false,
  meter,
  caption,
  first = false
}: {
  icon: LucideIcon
  label: string
  value: number
  total: string | null
  warn?: boolean
  meter: React.ReactNode
  caption: string
  first?: boolean
}) {
  const tones = useTeamTones()
  return (
    <View style={[styles.figure, !first && gaugeStyles.divided]}>
      <View style={styles.labelLine}>
        <Icon size={12} color={colors.textSecondary} />
        <Text style={gaugeStyles.label} numberOfLines={2}>
          {label}
        </Text>
      </View>
      <View style={styles.valueLine}>
        <Text style={[gaugeStyles.big, warn && { color: tones.warning }]}>{value}</Text>
        {total ? <Text style={gaugeStyles.side}>{total}</Text> : null}
      </View>
      {meter}
      {caption ? (
        <Text style={[gaugeStyles.side, warn && { color: tones.warning }]}>{caption}</Text>
      ) : null}
    </View>
  )
}

/** The fleet at a glance above the hosts: who can take a member, the agents, who is busy or low. */
export function TeamHostsSummary({
  machines,
  nameOf,
  words
}: {
  machines: TeamMachine[]
  nameOf: (machine: TeamMachine) => string
  words: TeamWorkWords
}) {
  const summary = teamMachinesSummaryOf(machines)
  const offline = (one: TeamMachine): boolean => one.reading.kind === 'unreachable'
  return (
    <View style={styles.strip}>
      <Figure
        first
        icon={Server}
        label={words.ready}
        value={summary.ready}
        total={words.ofTotal(summary.hosts)}
        meter={
          <Segments
            of={machines.map((one) =>
              offline(one) ? 'off' : one.launch.kind === 'ready' ? 'on' : 'none'
            )}
          />
        }
        caption={[
          ...(summary.blocked ? [words.blocked(summary.blocked)] : []),
          ...(summary.offline ? [words.offlineCount(summary.offline)] : [])
        ].join(' · ')}
      />
      <Figure
        icon={Bot}
        label={words.agents}
        value={summary.running}
        total={summary.cap === null ? null : words.ofTotal(summary.cap)}
        meter={
          <Meter
            label={words.agents}
            percent={
              summary.cap ? Math.min(100, Math.round((summary.running / summary.cap) * 100)) : null
            }
            warn={false}
            words={words}
          />
        }
        caption={summary.free === null ? '' : words.slotsFree(summary.free)}
      />
      <Figure
        icon={TriangleAlert}
        label={words.busyOrLow}
        value={summary.warned.length}
        total={null}
        warn={summary.warned.length > 0}
        meter={
          <Segments
            of={machines.map((one) =>
              offline(one) ? 'off' : teamMachineWarningsOf(one).length ? 'warning' : 'none'
            )}
          />
        }
        caption={summary.warned.map(nameOf).join(' · ')}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.bgBase,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle
  },
  figure: {
    flex: 1,
    gap: spacing.xs,
    paddingRight: spacing.sm
  },
  labelLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs
  },
  valueLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs
  },
  segments: {
    flexDirection: 'row',
    gap: 2,
    height: 4
  },
  segment: {
    flex: 1,
    borderRadius: 2,
    backgroundColor: colors.borderSubtle
  },
  off: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderSubtle
  }
})

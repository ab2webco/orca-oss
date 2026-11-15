import { StyleSheet, View } from 'react-native'
import type { TeamMachine } from '../../../src/shared/team-panel-model-types'
import type { SupportedUiLocale } from '../../../src/shared/ui-locale'
import { Text } from '../theme/dynamic-type-text'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import { teamSectionNote } from './team-section-note'
import type { TeamSheetWork } from './team-sheet-work'
import { TEAM_STATUS_TONE } from './team-status-tone'
import type { TeamWorkWords } from './team-work-words'

const GB = 1024 ** 3
const FULL_PERCENT = 95

function gbText(bytes: number, locale: SupportedUiLocale): string {
  const text = String(Math.round((bytes / GB) * 10) / 10)
  return locale === 'es' ? text.replace('.', ',') : text
}

function statusWord(machine: TeamMachine, words: TeamWorkWords): string {
  if (machine.reading.kind === 'unreachable') {
    return words.offline
  }
  if (machine.status === 'risk') {
    return words.lowMemory
  }
  if (machine.running === 0) {
    return words.free
  }
  return machine.cap === null
    ? words.running(machine.running)
    : words.runningOfCap(machine.running, machine.cap)
}

function MachineCard({
  machine,
  name,
  locale,
  words
}: {
  machine: TeamMachine
  name: string | null
  locale: SupportedUiLocale
  words: TeamWorkWords
}) {
  const { reading } = machine
  const used =
    reading.kind === 'ok'
      ? (reading.totalMemory - reading.availableMemory) / reading.totalMemory
      : 0
  const percent = Math.round(used * 100)
  const tone = TEAM_STATUS_TONE[machine.status]
  return (
    <View style={[styles.card, styles.machine]}>
      <View style={styles.titleLine}>
        <Text style={[styles.mono, styles.machineName]} numberOfLines={1}>
          {name ?? ''}
        </Text>
        <View style={[styles.dot, { backgroundColor: tone }]} />
        <Text style={[styles.side, machine.status !== 'idle' && { color: tone }]}>
          {statusWord(machine, words)}
        </Text>
      </View>
      {reading.kind === 'ok' ? (
        <>
          <View style={styles.track}>
            <View
              style={[
                styles.fill,
                {
                  width: `${percent}%`,
                  backgroundColor: percent >= FULL_PERCENT ? colors.statusRed : tone
                }
              ]}
            />
          </View>
          <Text style={styles.side}>
            {machine.status === 'risk'
              ? words.memoryFree(
                  gbText(reading.availableMemory, locale),
                  gbText(reading.totalMemory, locale)
                )
              : words.memoryUsed(percent)}
          </Text>
        </>
      ) : null}
    </View>
  )
}

/** Each host's agents and memory; this desktop by its own name, never 'local'. */
export function TeamHostsTab({
  machines,
  hostName,
  locale,
  words
}: {
  machines: TeamSheetWork['machines']
  hostName: string | null
  locale: SupportedUiLocale
  words: TeamWorkWords
}) {
  if (!machines) {
    return null
  }
  const note = teamSectionNote(machines, words.machinesError, words)
  const list = machines.kind === 'ready' ? machines.value : []
  const alone = machines.kind === 'ready' && list.every((one) => one.host.kind === 'local')
  return (
    <View style={styles.tab}>
      {note ? <Text style={styles.note}>{note}</Text> : null}
      {list.map((machine) => (
        <MachineCard
          key={machine.host.kind === 'local' ? 'local' : machine.host.name}
          machine={machine}
          name={machine.host.kind === 'local' ? hostName : machine.host.name}
          locale={locale}
          words={words}
        />
      ))}
      {alone ? (
        <View style={styles.section}>
          <Text style={styles.rowTitle}>{words.aloneTitle}</Text>
          <Text style={styles.note}>{words.aloneText}</Text>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  tab: {
    gap: spacing.md,
    marginBottom: spacing.lg
  },
  section: {
    gap: spacing.sm
  },
  titleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  card: {
    borderRadius: radii.card,
    backgroundColor: colors.bgBase,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle
  },
  mono: {
    color: colors.textMuted,
    fontFamily: typography.monoFamily,
    fontSize: typography.metaSize
  },
  rowTitle: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: typography.bodySize
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4
  },
  side: {
    color: colors.textSecondary,
    fontSize: typography.metaSize
  },
  note: {
    color: colors.textMuted,
    fontSize: typography.metaSize + 1
  },
  machine: {
    padding: spacing.md,
    gap: spacing.sm
  },
  machineName: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    fontWeight: '600'
  },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderSubtle,
    overflow: 'hidden'
  },
  fill: {
    height: 4
  }
})

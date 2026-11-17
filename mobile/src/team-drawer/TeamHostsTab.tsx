import { useState } from 'react'
import { ChevronRight, Cpu, HardDrive, MemoryStick } from 'lucide-react-native'
import { Pressable, StyleSheet, View } from 'react-native'
import {
  teamMachineGaugesOf,
  teamMachineWarningsOf,
  type TeamMachineWarning
} from '../../../src/shared/team-machine-board'
import type { TeamMachine } from '../../../src/shared/team-panel-model-types'
import type { SupportedUiLocale } from '../../../src/shared/ui-locale'
import { Text } from '../theme/dynamic-type-text'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import { Gauge, Readout } from './TeamHostGauges'
import type { TeamMemberRow } from './team-drawer-model'
import { teamSectionNote } from './team-section-note'
import type { TeamSheetWork } from './team-sheet-work'
import { TEAM_STATUS_ROLE, useTeamTones } from './team-status-tone'
import type { TeamWorkWords } from './team-work-words'

const GB = 1024 ** 3

function decimalText(value: number, locale: SupportedUiLocale): string {
  const text = String(Math.round(value * 10) / 10)
  return locale === 'es' ? text.replace('.', ',') : text
}

const gbText = (bytes: number, locale: SupportedUiLocale): string => decimalText(bytes / GB, locale)

function agentsWord(machine: TeamMachine, words: TeamWorkWords): string {
  return machine.cap === null
    ? words.running(machine.running)
    : words.runningOfCap(machine.running, machine.cap)
}

function statusWord(
  machine: TeamMachine,
  warnings: TeamMachineWarning[],
  words: TeamWorkWords
): string {
  if (machine.reading.kind === 'unreachable') {
    return words.offline
  }
  if (machine.running === 0 && machine.launch.kind !== 'ready') {
    return words.launch[machine.launch.kind]
  }
  if (warnings.length) {
    const said = warnings.map((one) => words.warning[one])
    return [...said, ...(machine.running > 0 ? [agentsWord(machine, words)] : [])].join(' · ')
  }
  if (machine.status === 'risk') {
    return words.lowMemory
  }
  return machine.running === 0 ? words.free : agentsWord(machine, words)
}

/** Why members cannot start there, as desktop's Machines tab says it (ORCA-1207). */
function launchNote(launch: TeamMachine['launch'], words: TeamWorkWords): string | null {
  switch (launch.kind) {
    case 'unregistered':
      return words.notRegisteredNote(launch.project)
    case 'refused':
      return launch.reason
    case 'unanswered':
      return words.notAnsweringNote
    case 'unknown':
      return words.unknownNote
    default:
      return null
  }
}

/** The tickets of the members on that host, once each; a row's null host is this desktop. */
function ticketsOn(machine: TeamMachine, members: readonly TeamMemberRow[]): string[] {
  const host = machine.host.kind === 'local' ? null : machine.host.name
  const tickets = members.filter((one) => one.host === host).map((one) => one.ticket)
  return [...new Set(tickets.filter((one): one is string => one !== null))]
}

// Why module-wide: a tab switch unmounts the cards, and the person's choice must outlive it.
const openChoices = new Map<string, boolean>()

function MachineDetail({
  machine,
  warnings,
  tickets,
  locale,
  words
}: {
  machine: TeamMachine
  warnings: TeamMachineWarning[]
  tickets: string[]
  locale: SupportedUiLocale
  words: TeamWorkWords
}) {
  const gauges = teamMachineGaugesOf(machine)
  const { reading } = machine
  if (!gauges || reading.kind !== 'ok') {
    return null
  }
  const cores = words.cores(reading.cpuCoreCount)
  const { workspaceDiskFree: diskFree, workspaceDiskTotal: diskTotal } = reading
  const slots = machine.cap === null ? 0 : Math.max(0, machine.cap - machine.running)
  return (
    <>
      <View style={styles.row}>
        <Readout
          first
          icon={Cpu}
          label={words.cpu}
          percent={gauges.cpu}
          warn={warnings.includes('busy')}
          caption={
            reading.loadAverage1m === null
              ? cores
              : `${words.load(decimalText(reading.loadAverage1m, locale))} · ${cores}`
          }
          words={words}
        />
        <Readout
          first={false}
          icon={MemoryStick}
          label={words.memory}
          percent={gauges.memory}
          warn={warnings.includes('lowMemory')}
          caption={words.memoryFree(
            gbText(reading.availableMemory, locale),
            gbText(reading.totalMemory, locale)
          )}
          words={words}
        />
        <Readout
          first={false}
          icon={HardDrive}
          label={words.disk}
          percent={gauges.disk}
          warn={warnings.includes('lowDisk')}
          caption={
            diskFree === undefined || diskTotal === undefined
              ? null
              : words.memoryFree(gbText(diskFree, locale), gbText(diskTotal, locale))
          }
          words={words}
        />
      </View>
      {tickets.length || slots ? (
        <View style={styles.tickets}>
          {tickets.map((ticket) => (
            <Text key={ticket} style={styles.ticket}>
              {ticket}
            </Text>
          ))}
          {slots ? <Text style={styles.side}>{words.slotsFree(slots)}</Text> : null}
        </View>
      ) : null}
    </>
  )
}

function MachineCard({
  machine,
  name,
  members,
  locale,
  words
}: {
  machine: TeamMachine
  name: string | null
  members: readonly TeamMemberRow[]
  locale: SupportedUiLocale
  words: TeamWorkWords
}) {
  const id = machine.host.kind === 'local' ? 'local' : machine.host.name
  const warnings = teamMachineWarningsOf(machine)
  const [chosen, setChosen] = useState(() => openChoices.get(id) ?? warnings.length > 0)
  const gauges = teamMachineGaugesOf(machine)
  const open = gauges !== null && chosen
  const tones = useTeamTones()
  const shown = warnings.length && machine.status !== 'attention' ? 'risk' : machine.status
  const tone = tones[TEAM_STATUS_ROLE[shown]]
  const note = machine.reading.kind === 'unreachable' ? null : launchNote(machine.launch, words)
  const toggle = () => {
    openChoices.set(id, !open)
    setChosen(!open)
  }
  return (
    <View style={[styles.card, styles.machine]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={name ?? ''}
        accessibilityState={{ expanded: open }}
        disabled={!gauges}
        onPress={toggle}
        style={styles.titleLine}
      >
        <View style={[styles.chevron, open && styles.chevronOpen, !gauges && styles.hidden]}>
          <ChevronRight size={14} color={colors.textMuted} />
        </View>
        <Text style={styles.machineName} numberOfLines={1}>
          {name ?? ''}
        </Text>
        <View style={[styles.dot, { backgroundColor: tone }]} />
        {/* Why no line limit: the status and the note below say what to do. */}
        <Text style={[styles.side, styles.status, shown !== 'idle' && { color: tone }]}>
          {statusWord(machine, warnings, words)}
        </Text>
      </Pressable>
      {note ? <Text style={styles.side}>{note}</Text> : null}
      {gauges && !open ? (
        <View style={styles.row}>
          <Gauge
            label={words.cpu}
            percent={gauges.cpu}
            warn={warnings.includes('busy')}
            words={words}
          />
          <Gauge
            label={words.memory}
            percent={gauges.memory}
            warn={warnings.includes('lowMemory')}
            words={words}
          />
          <Gauge
            label={words.disk}
            percent={gauges.disk}
            warn={warnings.includes('lowDisk')}
            words={words}
          />
        </View>
      ) : null}
      {open ? (
        <MachineDetail
          machine={machine}
          warnings={warnings}
          tickets={ticketsOn(machine, members)}
          locale={locale}
          words={words}
        />
      ) : null}
    </View>
  )
}

/** Each host's agents and memory; this desktop by its own name, never 'local'. */
export function TeamHostsTab({
  machines,
  members,
  hostName,
  locale,
  words
}: {
  machines: TeamSheetWork['machines']
  members: readonly TeamMemberRow[]
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
          members={members}
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
  // Why its own width: with flex 1 a wrapping status squeezes the name to nothing.
  machineName: {
    flexGrow: 1,
    flexShrink: 0,
    maxWidth: '60%',
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    fontWeight: '600'
  },
  status: {
    flexShrink: 1,
    textAlign: 'right'
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md
  },
  chevron: {
    width: 14
  },
  chevronOpen: {
    transform: [{ rotate: '90deg' }]
  },
  hidden: {
    opacity: 0
  },
  tickets: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: spacing.md
  },
  ticket: {
    color: colors.textPrimary,
    fontSize: typography.metaSize,
    fontWeight: '600'
  }
})

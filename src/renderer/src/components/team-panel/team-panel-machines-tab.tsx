import { useState } from 'react'
import { ChevronRight, Cpu, HardDrive, MemoryStick } from 'lucide-react'
import { statusToneTextClass } from '@/components/status-tone'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import {
  teamMachineGaugesOf,
  teamMachineTicketsOf,
  teamMachineWarningsOf,
  type TeamMachineWarning
} from '../../../../shared/team-machine-board'
import type { TeamMachine, TeamPanelModel } from '../../../../shared/team-panel-model-types'
import { teamStatusTone } from './team-card-text'
import { TeamHostName } from './TeamHostName'
import { Gauge, gbText, Readout, slotsFreeText } from './team-panel-machine-gauges'
import type { TeamPanelTabBodyProps } from './team-panel-tab-definition'
import { TeamPanelMessageState } from './team-panel-section-state'
import { TeamStatusMark } from './TeamStatusMark'

function launchWord(launch: TeamMachine['launch']): string | null {
  switch (launch.kind) {
    case 'unregistered':
      return translate('teamPanel.machines.notRegistered', 'Not registered')
    case 'refused':
      return translate('teamPanel.machines.refused', 'Refused')
    case 'unanswered':
      return translate('teamPanel.machines.notAnswering', 'Not answering')
    case 'unknown':
      return translate('teamPanel.machines.unknown', 'Unknown')
    case 'ready':
      return null
  }
}

/** What to do about a host this lead cannot launch on; the refusal is the launch's own text. */
function launchNote(launch: TeamMachine['launch']): string | null {
  switch (launch.kind) {
    case 'unregistered':
      return translate(
        'teamPanel.machines.notRegisteredNote',
        "{{project}} is not registered here. With the owner's OK, clone and register it.",
        { project: launch.project }
      )
    case 'refused':
      return launch.reason
    case 'unanswered':
      return translate(
        'teamPanel.machines.notAnsweringNote',
        'It did not list its repos, so Orca cannot tell if members can start here.'
      )
    case 'unknown':
      return translate(
        'teamPanel.machines.unknownNote',
        'This Orca does not say if members can start here. Update Orca Lab on this machine.'
      )
    case 'ready':
      return null
  }
}

const WARNING_WORDS: Record<TeamMachineWarning, () => string> = {
  busy: () => translate('teamPanel.machines.busy', 'Busy'),
  lowMemory: () => translate('teamPanel.machines.lowMemory', 'Low memory'),
  lowDisk: () => translate('teamPanel.machines.lowDisk', 'Low disk')
}

function agentsWord(machine: TeamMachine): string {
  if (machine.cap !== null) {
    return translate('teamPanel.machines.runningOfCap', '{{count}} of {{cap}} agents', {
      count: machine.running,
      cap: machine.cap
    })
  }
  return machine.running === 1
    ? translate('teamPanel.machines.runningOne', '1 agent')
    : translate('teamPanel.machines.running', '{{count}} agents', { count: machine.running })
}

function statusWord(machine: TeamMachine, warnings: TeamMachineWarning[]): string {
  if (machine.reading.kind === 'unreachable') {
    return translate('teamPanel.machines.offline', 'Offline')
  }
  const launch = machine.running === 0 ? launchWord(machine.launch) : null
  if (launch) {
    return launch
  }
  if (warnings.length) {
    const words = warnings.map((one) => WARNING_WORDS[one]())
    return [...words, ...(machine.running > 0 ? [agentsWord(machine)] : [])].join(' · ')
  }
  if (machine.status === 'risk') {
    return translate('teamPanel.machines.lowMemory', 'Low memory')
  }
  return machine.running === 0 ? translate('teamPanel.machines.free', 'Free') : agentsWord(machine)
}

// Why not the shown name: it is translated, and E2E and React need an id that stays put.
const machineId = (host: TeamMachine['host']): string =>
  host.kind === 'local' ? 'local' : host.name

// Why module-wide: a tab switch unmounts the rows, and the user's choice must outlive it.
const openChoices = new Map<string, boolean>()

function MachineCard({
  machine,
  warnings,
  tickets
}: {
  machine: TeamMachine
  warnings: TeamMachineWarning[]
  tickets: string[]
}): React.JSX.Element | null {
  const gauges = teamMachineGaugesOf(machine)
  if (!gauges || machine.reading.kind !== 'ok') {
    return null
  }
  const { reading } = machine
  const cores = translate('teamPanel.machines.cores', '{{count}} cores', {
    count: reading.cpuCoreCount
  })
  const free = (avail: number, total: number): string =>
    translate('teamPanel.machines.memoryFree', '{{free}} of {{total}} GB free', {
      free: gbText(avail),
      total: gbText(total)
    })
  const slots = machine.cap === null ? 0 : Math.max(0, machine.cap - machine.running)
  return (
    <div className="flex flex-col gap-2.5 pt-1">
      <div className="grid grid-cols-1 gap-2 @[300px]:grid-cols-3 @[300px]:gap-0">
        <Readout
          name="cpu"
          icon={Cpu}
          label={translate('teamPanel.machines.cpu', 'CPU')}
          percent={gauges.cpu}
          warn={warnings.includes('busy')}
          caption={
            reading.loadAverage1m === null
              ? cores
              : `${translate('teamPanel.machines.load', 'load {{load}}', {
                  load: reading.loadAverage1m.toFixed(1)
                })} · ${cores}`
          }
        />
        <Readout
          name="memory"
          icon={MemoryStick}
          label={translate('teamPanel.machines.memory', 'Memory')}
          percent={gauges.memory}
          warn={warnings.includes('lowMemory')}
          caption={free(reading.availableMemory, reading.totalMemory)}
        />
        <Readout
          name="disk"
          icon={HardDrive}
          label={translate('teamPanel.machines.disk', 'Disk')}
          percent={gauges.disk}
          warn={warnings.includes('lowDisk')}
          caption={
            reading.workspaceDiskFree === undefined || reading.workspaceDiskTotal === undefined
              ? null
              : free(reading.workspaceDiskFree, reading.workspaceDiskTotal)
          }
        />
      </div>
      {tickets.length || slots ? (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[12px] tabular-nums">
          {tickets.map((ticket) => (
            <span key={ticket} className="font-medium">
              {ticket}
            </span>
          ))}
          {slots ? <span className="text-muted-foreground">{slotsFreeText(slots)}</span> : null}
        </div>
      ) : null}
    </div>
  )
}

function MachineRow({
  machine,
  model
}: {
  machine: TeamMachine
  model: TeamPanelModel
}): React.JSX.Element {
  const id = machineId(machine.host)
  const warnings = teamMachineWarningsOf(machine)
  const [open, setOpen] = useState(() => openChoices.get(id) ?? warnings.length > 0)
  const gauges = teamMachineGaugesOf(machine)
  const shown = warnings.length && machine.status !== 'attention' ? 'risk' : machine.status
  const tone = teamStatusTone(shown)
  const note = machine.reading.kind === 'unreachable' ? null : launchNote(machine.launch)
  const toggle = (next: boolean): void => {
    openChoices.set(id, next)
    setOpen(next)
  }
  return (
    <Collapsible
      open={gauges ? open : false}
      onOpenChange={toggle}
      data-team-machine={id}
      className="@container flex flex-col gap-2 border-b border-border px-3 py-2.5 last:border-b-0 data-[state=open]:bg-muted/30"
    >
      <CollapsibleTrigger
        disabled={!gauges}
        className="-mx-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-md px-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50 enabled:hover:bg-accent"
      >
        <ChevronRight
          className={cn('size-3.5 flex-none text-muted-foreground transition-transform', {
            'rotate-90': open && gauges,
            invisible: !gauges
          })}
        />
        {/* Why wrap, not shrink: a long status pushed to its own line keeps the host's name whole. */}
        <b
          data-team-machine-name
          className="min-w-0 max-w-[calc(100%-1.25rem)] truncate text-[13px] font-medium"
        >
          <TeamHostName host={machine.host} />
        </b>
        <span
          data-team-machine-status
          className={cn('ml-auto inline-flex min-w-0 max-w-full items-center gap-1.5 text-[12px]', {
            [statusToneTextClass(tone)]: shown !== 'idle',
            'text-muted-foreground': shown === 'idle'
          })}
        >
          <TeamStatusMark status={shown} />
          {/* Why wrap, never cut: the status and the note below say what to do. */}
          <span className="min-w-0 break-words">{statusWord(machine, warnings)}</span>
        </span>
      </CollapsibleTrigger>
      {note ? (
        <small
          data-team-machine-launch={machine.launch.kind}
          className="break-words text-[12px] text-muted-foreground"
        >
          {note}
        </small>
      ) : null}
      {gauges && !open ? (
        <div className="grid grid-cols-1 gap-2 @[300px]:grid-cols-3 @[300px]:gap-3">
          <Gauge
            name="cpu"
            label={translate('teamPanel.machines.cpu', 'CPU')}
            percent={gauges.cpu}
            warn={warnings.includes('busy')}
          />
          <Gauge
            name="memory"
            label={translate('teamPanel.machines.memory', 'Memory')}
            percent={gauges.memory}
            warn={warnings.includes('lowMemory')}
          />
          <Gauge
            name="disk"
            label={translate('teamPanel.machines.disk', 'Disk')}
            percent={gauges.disk}
            warn={warnings.includes('lowDisk')}
          />
        </div>
      ) : null}
      <CollapsibleContent>
        <MachineCard
          machine={machine}
          warnings={warnings}
          tickets={model.kind === 'team' ? teamMachineTicketsOf(machine, model.members) : []}
        />
      </CollapsibleContent>
    </Collapsible>
  )
}

/** The tab's empty copy, also shown under this machine when it is the only one (V28 state-empty-hosts). */
export const teamMachinesAloneCopy = (): { title: string; text: string } => ({
  title: translate('teamPanel.tabs.machines.emptyTitle', 'Only this machine'),
  text: translate(
    'teamPanel.tabs.machines.emptyText',
    'Pair another machine to spread agents across hosts.'
  )
})

export function TeamPanelMachinesTab({
  value,
  model
}: TeamPanelTabBodyProps<TeamMachine[]>): React.JSX.Element {
  const alone = value.every((machine) => machine.host.kind === 'local')
  return (
    <div className={cn('@container flex flex-col pt-1.5', { 'pb-3': !alone })}>
      {value.map((machine) => (
        <MachineRow key={machineId(machine.host)} machine={machine} model={model} />
      ))}
      {alone ? <TeamPanelMessageState {...teamMachinesAloneCopy()} /> : null}
    </div>
  )
}

import { StatusDot } from '@/components/StatusDot'
import { statusToneTextClass } from '@/components/status-tone'
import { getIntlLocale, translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { TeamMachine } from '../../../../shared/team-panel-model-types'
import { teamHostText, teamStatusTone } from './team-card-text'
import type { TeamPanelTabBodyProps } from './team-panel-tab-definition'

const GB = 1024 ** 3
const FULL_PERCENT = 95

type MachineReading = Extract<TeamMachine['reading'], { kind: 'ok' }>

function statusWord(machine: TeamMachine): string {
  if (machine.reading.kind === 'unreachable') {
    return translate('teamPanel.machines.offline', 'Offline')
  }
  if (machine.status === 'risk') {
    return translate('teamPanel.machines.lowMemory', 'Low memory')
  }
  if (machine.running === 0) {
    return translate('teamPanel.machines.free', 'Free')
  }
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

function MemoryBar({
  machine,
  reading
}: {
  machine: TeamMachine
  reading: MachineReading
}): React.JSX.Element {
  const { totalMemory, availableMemory } = reading
  const used = (totalMemory - availableMemory) / totalMemory
  const percent = Math.round(used * 100)
  const gb = new Intl.NumberFormat(getIntlLocale(), { maximumFractionDigits: 1 })
  return (
    <>
      <span
        role="img"
        aria-label={translate('teamPanel.machines.memoryUsed', 'Memory used {{percent}}%', {
          percent
        })}
        className="block h-1 w-full overflow-hidden rounded-full bg-muted"
      >
        <span
          style={{ transform: `scaleX(${used})` }}
          className={cn('block h-full origin-left', {
            'bg-status-attention': percent >= FULL_PERCENT,
            'bg-status-warning': percent < FULL_PERCENT && machine.status === 'risk',
            'bg-muted-foreground': percent < FULL_PERCENT && machine.status !== 'risk'
          })}
        />
      </span>
      <small className="text-[11.5px] tabular-nums text-muted-foreground">
        {translate('teamPanel.machines.memoryFree', '{{free}} of {{total}} GB free', {
          free: gb.format(availableMemory / GB),
          total: gb.format(totalMemory / GB)
        })}
      </small>
    </>
  )
}

function MachineRow({ machine }: { machine: TeamMachine }): React.JSX.Element {
  const tone = teamStatusTone(machine.status)
  return (
    <div
      data-team-machine={teamHostText(machine.host)}
      className="flex flex-col gap-1.5 border-b border-border px-3 py-2.5 last:border-b-0"
    >
      <div className="flex min-w-0 items-center gap-2">
        <b className="min-w-0 flex-1 truncate font-mono text-[12.5px] font-medium">
          {teamHostText(machine.host)}
        </b>
        <span
          className={cn('inline-flex flex-none items-center gap-1.5 text-[11.5px]', {
            [statusToneTextClass(tone)]: machine.status !== 'idle',
            'text-muted-foreground': machine.status === 'idle'
          })}
        >
          <StatusDot tone={tone} />
          {statusWord(machine)}
        </span>
      </div>
      {machine.reading.kind === 'ok' ? (
        <MemoryBar machine={machine} reading={machine.reading} />
      ) : null}
    </div>
  )
}

export function TeamPanelMachinesTab({
  value
}: TeamPanelTabBodyProps<TeamMachine[]>): React.JSX.Element {
  return (
    <div className="flex flex-col pb-3 pt-1.5">
      {value.map((machine) => (
        <MachineRow key={teamHostText(machine.host)} machine={machine} />
      ))}
    </div>
  )
}

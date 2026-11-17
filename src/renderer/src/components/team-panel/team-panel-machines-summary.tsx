import { Bot, Server, TriangleAlert, type LucideIcon } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { useLocalHostName } from '@/lib/use-local-host-name'
import { teamMachinesSummaryOf, teamMachineWarningsOf } from '../../../../shared/team-machine-board'
import type { TeamMachine } from '../../../../shared/team-panel-model-types'
import { teamHostText } from './team-card-text'
import { gaugeLabelClass, Meter, slotsFreeText, UNKNOWN_TRACK } from './team-panel-machine-gauges'

type Segment = 'on' | 'off' | 'warning' | 'none'

/** One segment per host, so the strip shows which share of the fleet a figure is. */
function Segments({ of }: { of: Segment[] }): React.JSX.Element {
  return (
    <span className="grid h-1 auto-cols-fr grid-flow-col gap-0.5">
      {of.map((one, index) => (
        <i
          key={index}
          className={cn('rounded-full', {
            'bg-muted-foreground': one === 'on',
            'bg-status-warning': one === 'warning',
            'bg-foreground/10': one === 'none',
            [UNKNOWN_TRACK]: one === 'off'
          })}
        />
      ))}
    </span>
  )
}

function Figure({
  name,
  icon: Icon,
  label,
  value,
  total,
  warn = false,
  meter,
  lines
}: {
  name: string
  icon: LucideIcon
  label: string
  value: number
  total: string | null
  warn?: boolean
  meter: React.ReactNode
  lines: string[]
}): React.JSX.Element {
  return (
    <div
      data-team-machines-figure={name}
      className="grid min-w-0 grid-cols-[auto_1fr] items-baseline gap-x-2 gap-y-1.5 border-t border-border px-3 py-2.5 first:border-t-0 @[300px]:flex @[300px]:flex-col @[300px]:border-l @[300px]:border-t-0 @[300px]:py-0 @[300px]:first:border-l-0"
    >
      <span className={cn(gaugeLabelClass, 'break-words')}>
        <Icon className="size-3.5 flex-none" />
        {label}
      </span>
      <span
        className={cn(
          'text-right text-lg font-semibold leading-tight tabular-nums @[300px]:text-left',
          {
            'text-status-warning': warn
          }
        )}
      >
        {value}
        {total ? ' ' : null}
        {total ? (
          <small className="ml-1 text-[11px] font-medium text-muted-foreground">{total}</small>
        ) : null}
      </span>
      <span className="col-span-2 w-full">{meter}</span>
      <small
        className={cn('col-span-2 min-w-0 text-[11px] tabular-nums', {
          'text-status-warning': warn,
          'text-muted-foreground': !warn
        })}
      >
        {lines.join(' · ')}
      </small>
    </div>
  )
}

/** The fleet at a glance above the hosts: who can take a member, the agents, who is busy or low. */
export function TeamMachinesSummary({ machines }: { machines: TeamMachine[] }): React.JSX.Element {
  const localName = useLocalHostName()
  const summary = teamMachinesSummaryOf(machines)
  const offline = (one: TeamMachine): boolean => one.reading.kind === 'unreachable'
  const of = (total: number): string =>
    translate('teamPanel.machines.ofTotal', 'of {{total}}', { total })
  return (
    <div
      data-team-machines-summary
      className="mx-3 mb-2 mt-1 grid grid-cols-1 rounded-xl border border-border bg-muted/50 @[300px]:grid-cols-3 @[300px]:py-3"
    >
      <Figure
        name="ready"
        icon={Server}
        label={translate('teamPanel.machines.ready', 'Ready')}
        value={summary.ready}
        total={of(summary.hosts)}
        meter={
          <Segments
            of={machines.map((one) =>
              offline(one) ? 'off' : one.launch.kind === 'ready' ? 'on' : 'none'
            )}
          />
        }
        lines={[
          ...(summary.blocked
            ? [
                translate('teamPanel.machines.blocked', "{{count}} can't launch", {
                  count: summary.blocked
                })
              ]
            : []),
          ...(summary.offline
            ? [
                translate('teamPanel.machines.offlineCount', '{{count}} offline', {
                  count: summary.offline
                })
              ]
            : [])
        ]}
      />
      <Figure
        name="agents"
        icon={Bot}
        label={translate('teamPanel.machines.agents', 'Agents')}
        value={summary.running}
        total={summary.cap === null ? null : of(summary.cap)}
        meter={
          <Meter
            label={translate('teamPanel.machines.agents', 'Agents')}
            percent={
              summary.cap ? Math.min(100, Math.round((summary.running / summary.cap) * 100)) : null
            }
            warn={false}
          />
        }
        lines={summary.free === null ? [] : [slotsFreeText(summary.free)]}
      />
      <Figure
        name="warned"
        icon={TriangleAlert}
        label={translate('teamPanel.machines.busyOrLow', 'Busy / low')}
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
        lines={summary.warned.map((one) => teamHostText(one.host, localName))}
      />
    </div>
  )
}

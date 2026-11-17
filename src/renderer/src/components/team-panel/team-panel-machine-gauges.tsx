import type { LucideIcon } from 'lucide-react'
import { getIntlLocale, translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'

const GB = 1024 ** 3

// Why a dotted track: an unknown figure must not look like an empty bar, which reads as 0%.
export const UNKNOWN_TRACK =
  'bg-[repeating-linear-gradient(90deg,var(--border)_0_3px,transparent_3px_6px)]'

export const gbText = (bytes: number): string =>
  new Intl.NumberFormat(getIntlLocale(), { maximumFractionDigits: 1 }).format(bytes / GB)

export const slotsFreeText = (count: number): string =>
  count === 1
    ? translate('teamPanel.machines.slotFreeOne', '1 slot free')
    : translate('teamPanel.machines.slotsFree', '{{count}} slots free', { count })

export function Meter({
  label,
  percent,
  warn
}: {
  label: string
  percent: number | null
  warn: boolean
}): React.JSX.Element {
  if (percent === null) {
    return <span className={cn('block h-1 w-full rounded-full', UNKNOWN_TRACK)} />
  }
  return (
    <span
      role="img"
      aria-label={translate('teamPanel.machines.used', '{{label}} used {{percent}}%', {
        label,
        percent
      })}
      className="block h-1 w-full overflow-hidden rounded-full bg-foreground/10"
    >
      <span
        style={{ transform: `scaleX(${percent / 100})` }}
        className={cn(
          'block h-full origin-left',
          warn ? 'bg-status-warning' : 'bg-muted-foreground'
        )}
      />
    </span>
  )
}

export const gaugeLabelClass =
  'flex min-w-0 items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground'

/** A collapsed row's thin bar: its name, its percent, and the bar. */
export function Gauge({
  name,
  label,
  percent,
  warn
}: {
  name: string
  label: string
  percent: number | null
  warn: boolean
}): React.JSX.Element {
  return (
    <span data-team-machine-gauge={name} className="flex min-w-0 flex-col gap-1">
      <span className="flex items-baseline justify-between gap-1">
        <span className={gaugeLabelClass}>{label}</span>
        <span
          className={cn('text-[12px] font-medium tabular-nums', {
            'text-status-warning': warn,
            'text-muted-foreground': percent === null
          })}
        >
          {percent === null ? '—' : `${percent}%`}
        </span>
      </span>
      <Meter label={label} percent={percent} warn={warn} />
    </span>
  )
}

/** An open card's readout: the big percent, the bar, and what it is made of. */
export function Readout({
  name,
  icon: Icon,
  label,
  percent,
  warn,
  caption
}: {
  name: string
  icon: LucideIcon
  label: string
  percent: number | null
  warn: boolean
  caption: string | null
}): React.JSX.Element {
  return (
    <span
      data-team-machine-readout={name}
      className="grid min-w-0 grid-cols-[auto_1fr] items-baseline gap-x-2 gap-y-1 border-border @[300px]:flex @[300px]:flex-col @[300px]:gap-1.5 @[300px]:border-l @[300px]:px-2.5 @[300px]:first:border-l-0 @[300px]:first:pl-0 @[300px]:last:pr-0"
    >
      <span className={gaugeLabelClass}>
        <Icon className="size-3.5 flex-none" />
        {label}
      </span>
      <span
        className={cn(
          'text-right text-lg font-semibold leading-tight tabular-nums @[300px]:text-left',
          {
            'text-status-warning': warn,
            'text-[12px] font-medium text-muted-foreground': percent === null
          }
        )}
      >
        {percent === null ? translate('teamPanel.machines.unknown', 'Unknown') : `${percent}%`}
      </span>
      <span className="col-span-2">
        <Meter label={label} percent={percent} warn={warn} />
      </span>
      {caption ? (
        <small className="col-span-2 text-[11px] tabular-nums text-muted-foreground">
          {caption}
        </small>
      ) : null}
    </span>
  )
}

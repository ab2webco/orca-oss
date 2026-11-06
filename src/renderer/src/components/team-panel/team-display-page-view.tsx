import { getIntlLocale, translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { TeamDisplayPage } from './team-display-pages'
import { teamHostText } from './team-card-text'
import {
  Bars,
  Blocks,
  DisplayLabel,
  LineChart,
  NoData,
  SegmentNumber,
  noDataText
} from './team-display-figures'

type PageOf<K extends TeamDisplayPage['id']> = Extract<TeamDisplayPage, { id: K }>

const HOT_PERCENT = 80

export const teamDisplayPageTitle = (id: TeamDisplayPage['id']): string =>
  ({
    summary: translate('teamPanel.display.page.summary', 'Summary'),
    delivery: translate('teamPanel.display.page.delivery', 'Delivery'),
    quality: translate('teamPanel.display.page.quality', 'Quality'),
    machines: translate('teamPanel.display.page.machines', 'Machines'),
    usage: translate('teamPanel.display.page.usage', 'Usage')
  })[id]

function durationText(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  const hours = Math.floor(minutes / 60)
  return hours > 0
    ? translate('teamPanel.display.hoursMinutes', '{{hours}} h {{minutes}} m', {
        hours,
        minutes: minutes % 60
      })
    : translate('teamPanel.display.minutes', '{{minutes}} m', { minutes })
}

const weekdayOf = (day: string): string =>
  new Intl.DateTimeFormat(getIntlLocale(), { weekday: 'narrow', timeZone: 'UTC' }).format(
    new Date(`${day}T12:00:00Z`)
  )

const percentText = (value: number | null): string => (value === null ? '—' : `${value}%`)

/** A big figure on the left, its detail on the right, as V28 lays out every page but two. */
function Split({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="grid h-full grid-cols-[104px_minmax(0,1fr)] gap-3.5 @max-[260px]:grid-cols-[76px_minmax(0,1fr)] @max-[260px]:gap-2.5">
      <div className="flex min-w-0 flex-col gap-1.5">{left}</div>
      <div className="flex min-w-0 flex-col gap-1.5">{right}</div>
    </div>
  )
}

function Kpi({
  label,
  value,
  alert = false
}: {
  label: string
  value: number | null
  alert?: boolean
}) {
  return (
    <div
      data-team-display-kpi=""
      className="flex min-w-0 flex-col gap-1.5 border-l border-border pl-2.5 first:border-l-0 first:pl-0 @max-[260px]:pl-1.5"
    >
      <DisplayLabel
        className={cn(
          'truncate uppercase @max-[260px]:text-[9px]',
          alert && 'text-status-attention'
        )}
      >
        {label}
      </DisplayLabel>
      <SegmentNumber value={value} alert={alert} />
    </div>
  )
}

function SummaryPage({ page }: { page: PageOf<'summary'> }) {
  const meters: [string, number | null][] = [
    ['CI', page.meters.ciGreenPercent],
    ['5H', page.meters.sessionPercent],
    ['7D', page.meters.weeklyPercent]
  ]
  const hours = page.mergedPerHour24h
  return (
    <div className="flex h-full flex-col gap-2.5">
      <div className="grid grid-cols-4">
        <Kpi label={translate('teamPanel.display.active', 'Active')} value={page.active} />
        <Kpi
          label={translate('teamPanel.display.alerts', 'Alerts')}
          value={page.alerts}
          alert={(page.alerts ?? 0) > 0}
        />
        <Kpi label={translate('teamPanel.display.queued', 'Queued')} value={page.queued} />
        <Kpi label={translate('teamPanel.display.merges', 'Merges')} value={page.mergedToday} />
      </div>
      <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-3.5">
        <div className="flex min-w-0 flex-col gap-1.5">
          <DisplayLabel className="flex justify-between">
            {translate('teamPanel.display.merges24h', 'Merges 24 h')}
            {hours ? (
              <b className="font-medium text-foreground">{hours.reduce((a, b) => a + b, 0)}</b>
            ) : null}
          </DisplayLabel>
          {hours ? (
            <Bars values={hours} className="h-[22px]" />
          ) : (
            <NoData text={translate('teamPanel.display.noHourly', 'No hourly data')} />
          )}
        </div>
        <div className="flex min-w-0 flex-col justify-between gap-1">
          {meters.map(([label, value]) => (
            <div
              key={label}
              className="grid grid-cols-[20px_minmax(0,1fr)_32px] items-center gap-1.5"
            >
              <DisplayLabel>{label}</DisplayLabel>
              <span className="h-[3px] overflow-hidden bg-foreground/[0.06]">
                <b className="block h-full bg-foreground" style={{ width: `${value ?? 0}%` }} />
              </span>
              <span className="text-right text-[11px] tabular-nums text-foreground">
                {percentText(value)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function DeliveryPage({ page }: { page: PageOf<'delivery'> }) {
  const peak = Math.max(1, ...page.days.map((one) => one.merged))
  return (
    <Split
      left={
        <>
          <DisplayLabel>{translate('teamPanel.display.merges7d', 'Merges 7 d')}</DisplayLabel>
          <SegmentNumber value={page.merged7d} />
          <DisplayLabel wrap>
            {page.leadTimeMedianMs === null
              ? translate('teamPanel.display.noLeadTime', 'No lead time yet')
              : translate('teamPanel.display.median', 'Median {{time}}', {
                  time: durationText(page.leadTimeMedianMs)
                })}
          </DisplayLabel>
        </>
      }
      right={
        page.days.length === 0 ? (
          <NoData
            text={translate('teamPanel.display.noMerges', 'No merge history from this host')}
          />
        ) : (
          <div className="grid h-full min-w-0 grid-cols-7 gap-1.5">
            {page.days.map((one, index) => (
              <div key={one.day} className="flex min-w-0 flex-col items-center gap-1">
                <span className="text-[11px] tabular-nums text-foreground">{one.merged}</span>
                <span className="flex w-full flex-1 items-end">
                  <i
                    className={cn(
                      'block w-full rounded-t-[1px]',
                      index === page.days.length - 1 ? 'bg-foreground' : 'bg-muted-foreground/60'
                    )}
                    style={{ height: `${Math.max(6, (one.merged / peak) * 100)}%` }}
                  />
                </span>
                <DisplayLabel>{weekdayOf(one.day)}</DisplayLabel>
              </div>
            ))}
          </div>
        )
      }
    />
  )
}

function QualityPage({ page }: { page: PageOf<'quality'> }) {
  return (
    <Split
      left={
        <>
          <DisplayLabel>{translate('teamPanel.display.ciGreen', 'CI green')}</DisplayLabel>
          <SegmentNumber value={page.ciGreenPercent} unit="%" />
          <DisplayLabel>
            {page.flakyChecks === null
              ? noDataText()
              : translate('teamPanel.display.flaky', '{{count}} flaky', {
                  count: page.flakyChecks
                })}
          </DisplayLabel>
        </>
      }
      right={
        <>
          <DisplayLabel>{translate('teamPanel.display.days14', '14 days')}</DisplayLabel>
          {page.ciGreenPerDay ? (
            <LineChart values={page.ciGreenPerDay} />
          ) : (
            <NoData
              text={translate('teamPanel.display.noCiHistory', 'Orca keeps no CI history yet')}
            />
          )}
        </>
      }
    />
  )
}

function MachinesPage({ page }: { page: PageOf<'machines'> }) {
  if (!page.rows || page.rows.length === 0) {
    return (
      <NoData text={translate('teamPanel.display.noMachines', 'No machine data from this host')} />
    )
  }
  return (
    <div className="grid grid-cols-[54px_minmax(0,1fr)_minmax(0,1fr)_46px] items-center gap-x-2.5 gap-y-[7px] @max-[260px]:gap-x-1.5">
      <span />
      <DisplayLabel>CPU</DisplayLabel>
      <DisplayLabel>RAM</DisplayLabel>
      <DisplayLabel>{translate('teamPanel.display.agents', 'Agents')}</DisplayLabel>
      {page.rows.map((row) => (
        <div key={row.key} className="contents">
          <span className="truncate text-[11.5px] text-foreground">{teamHostText(row.host)}</span>
          {row.cpuPercent === null ? (
            <DisplayLabel wrap className="col-span-2 text-status-attention">
              {translate('teamPanel.display.offline', 'Offline')}
            </DisplayLabel>
          ) : (
            <>
              <Blocks percent={row.cpuPercent} />
              <Blocks percent={row.memoryPercent} />
            </>
          )}
          <span className="text-right text-[11px] tabular-nums text-foreground">
            {row.cap === null ? row.running : `${row.running}/${row.cap}`}
          </span>
        </div>
      ))}
    </div>
  )
}

function UsagePage({ page }: { page: PageOf<'usage'> }) {
  const today = page.costPerDay?.at(-1) ?? null
  return (
    <Split
      left={
        <>
          <DisplayLabel>{translate('teamPanel.display.costToday', 'Cost today')}</DisplayLabel>
          <SegmentNumber value={today?.amount ?? null} prefix={today ? '$' : ''} />
          {page.costPerDay ? (
            <LineChart values={page.costPerDay.map((one) => one.amount)} />
          ) : (
            <NoData text={translate('teamPanel.display.noCost', 'Orca has no cost data')} />
          )}
        </>
      }
      right={
        <>
          <DisplayLabel wrap>
            {translate('teamPanel.display.accounts7d', 'Accounts · 7 days')}
          </DisplayLabel>
          {page.accounts && page.accounts.length > 0 ? (
            page.accounts.map((one) => (
              <div
                key={one.email}
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_30px] items-center gap-1.5 @max-[260px]:grid-cols-[minmax(0,1fr)_30px]"
              >
                <span className="truncate text-[11.5px] text-foreground">
                  {one.email.split('@')[0]}
                </span>
                <Blocks
                  percent={one.weeklyPercent}
                  hot={(one.weeklyPercent ?? 0) >= HOT_PERCENT}
                  className="@max-[260px]:hidden"
                />
                <span className="text-right text-[11px] tabular-nums text-foreground">
                  {percentText(one.weeklyPercent)}
                </span>
              </div>
            ))
          ) : (
            <NoData text={translate('teamPanel.display.noAccounts', 'No account use reported')} />
          )}
        </>
      }
    />
  )
}

export function TeamDisplayPageView({ page }: { page: TeamDisplayPage }): React.JSX.Element {
  switch (page.id) {
    case 'summary':
      return <SummaryPage page={page} />
    case 'delivery':
      return <DeliveryPage page={page} />
    case 'quality':
      return <QualityPage page={page} />
    case 'machines':
      return <MachinesPage page={page} />
    case 'usage':
      return <UsagePage page={page} />
  }
}

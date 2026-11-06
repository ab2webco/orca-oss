import { StatusDot } from '@/components/StatusDot'
import { statusToneTextClass } from '@/components/status-tone'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { TeamPrList, TeamPrRow } from '../../../../shared/team-panel-model-types'
import { teamStatusTone } from './team-card-text'
import type { TeamPanelTabBodyProps } from './team-panel-tab-definition'

function reasonText(reason: TeamPrRow['reason']): string {
  switch (reason) {
    case 'checksFailed':
      return translate('teamPanel.prs.reason.checksFailed', 'Check failed')
    case 'checksUnknown':
      return translate('teamPanel.prs.reason.checksUnknown', 'CI unknown')
    case 'conflict':
      return translate('teamPanel.prs.reason.conflict', 'Conflict')
    case 'inReview':
      return translate('teamPanel.prs.reason.inReview', 'In review')
    case 'ready':
      return translate('teamPanel.prs.reason.ready', 'Ready')
    case 'draft':
      return translate('teamPanel.prs.reason.draft', 'Draft')
    case 'merged':
      return translate('teamPanel.prs.reason.merged', 'Merged')
    case 'closed':
      return translate('teamPanel.prs.reason.closed', 'Closed')
  }
}

function PrRow({ row }: { row: TeamPrRow }): React.JSX.Element {
  const tone = teamStatusTone(row.status)
  return (
    <a
      data-team-pr={row.label}
      href={row.url}
      target="_blank"
      rel="noreferrer"
      className="flex min-h-[34px] min-w-0 items-center gap-2 px-3 text-[12.5px] hover:bg-sidebar-accent"
    >
      <code className="flex-none font-mono text-xs">{row.label}</code>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{row.title}</span>
      <span
        className={cn('inline-flex flex-none items-center gap-1.5 text-[11.5px]', {
          [statusToneTextClass(tone)]: row.status !== 'idle',
          'text-muted-foreground': row.status === 'idle'
        })}
      >
        <StatusDot tone={tone} />
        {reasonText(row.reason)}
      </span>
    </a>
  )
}

export function TeamPanelPrsTab({ value }: TeamPanelTabBodyProps<TeamPrList>): React.JSX.Element {
  const { rows, total, listUrl } = value
  return (
    <div className="flex flex-col pb-3 pt-1.5">
      {rows.map((row) => (
        <PrRow key={row.url} row={row} />
      ))}
      {listUrl && total > rows.length ? (
        <a
          data-team-pr-more=""
          href={listUrl}
          target="_blank"
          rel="noreferrer"
          className="px-3 py-2 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {translate('teamPanel.prs.viewAll', 'View all {{count}}', { count: total })}
        </a>
      ) : null}
    </div>
  )
}

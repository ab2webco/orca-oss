import { statusToneTextClass } from '@/components/status-tone'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { TeamPrList, TeamPrRow } from '../../../../shared/team-panel-model-types'
import { teamStatusTone } from './team-card-text'
import type { TeamPanelTabBodyProps } from './team-panel-tab-definition'
import { TeamPanelQueueSection, teamQueueEntriesOf } from './team-panel-queue-section'
import { TeamStatusMark } from './TeamStatusMark'
import { useTeamLeadPrompt } from './use-team-lead-prompt'

const MORE_CLASS =
  'px-3 py-2 text-left text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline'

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
        <TeamStatusMark status={row.status} />
        {reasonText(row.reason)}
      </span>
    </a>
  )
}

export function TeamPanelPrsTab({
  value,
  model
}: TeamPanelTabBodyProps<TeamPrList>): React.JSX.Element {
  const { rows, total, listUrl, listAction } = value
  const send = useTeamLeadPrompt()
  const more = total > rows.length
  const viewAll = translate('teamPanel.prs.viewAll', 'View all {{count}}', { count: total })
  return (
    <div className="flex flex-col pb-3 pt-1.5">
      <TeamPanelQueueSection entries={teamQueueEntriesOf(model)} />
      {model.prs?.kind === 'error' ? (
        <p data-team-pr-failure="" className="px-3 py-2 text-xs text-muted-foreground">
          {`${translate('teamPanel.tabs.prs.errorTitle', 'Could not read pull requests')} · ${model.prs.message}`}
        </p>
      ) : null}
      {rows.map((row) => (
        <PrRow key={row.url} row={row} />
      ))}
      {more && listAction && send ? (
        <button
          type="button"
          data-team-pr-more=""
          className={MORE_CLASS}
          onClick={() => void send(listAction.id, listAction.prompt, listAction.label)}
        >
          {viewAll}
        </button>
      ) : more && listUrl ? (
        <a
          data-team-pr-more=""
          href={listUrl}
          target="_blank"
          rel="noreferrer"
          className={MORE_CLASS}
        >
          {viewAll}
        </a>
      ) : null}
    </div>
  )
}

import { StatusDot } from '@/components/StatusDot'
import { statusToneTextClass } from '@/components/status-tone'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { TeamQueueEntry } from '../../../../shared/team-panel-model-types'
import { teamStatusTone } from './team-card-text'
import type { TeamPanelTabBodyProps } from './team-panel-tab-definition'

function stateText(entry: TeamQueueEntry): string {
  if (entry.longWaitHours !== null) {
    return translate('teamPanel.queue.longWait', 'For {{hours}} h', { hours: entry.longWaitHours })
  }
  switch (entry.state) {
    case 'checks':
      return translate('teamPanel.queue.checks', 'In checks')
    case 'waiting':
      return translate('teamPanel.queue.waiting', 'In queue')
    case 'failed':
      return translate('teamPanel.queue.failed', 'Failed')
  }
}

function QueueRow({ entry }: { entry: TeamQueueEntry }): React.JSX.Element {
  const tone = teamStatusTone(entry.status)
  return (
    <a
      data-team-queue={entry.label}
      href={entry.url}
      target="_blank"
      rel="noreferrer"
      className="flex min-h-[34px] min-w-0 items-center gap-2 px-3 text-[12.5px] hover:bg-sidebar-accent"
    >
      <span className="w-4 flex-none text-right font-mono text-[11.5px] text-muted-foreground">
        {entry.position}
      </span>
      <code className="flex-none font-mono text-xs">{entry.label}</code>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{entry.title}</span>
      <span
        className={cn('inline-flex flex-none items-center gap-1.5 text-[11.5px]', {
          [statusToneTextClass(tone)]: entry.status !== 'idle',
          'text-muted-foreground': entry.status === 'idle'
        })}
      >
        <StatusDot tone={tone} />
        {stateText(entry)}
      </span>
    </a>
  )
}

export function TeamPanelQueueTab({
  value
}: TeamPanelTabBodyProps<TeamQueueEntry[]>): React.JSX.Element {
  return (
    <div className="flex flex-col pb-3 pt-1.5">
      {value.map((entry) => (
        <QueueRow key={entry.url} entry={entry} />
      ))}
    </div>
  )
}

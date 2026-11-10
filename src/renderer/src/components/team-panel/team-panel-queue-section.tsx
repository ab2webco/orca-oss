import { statusToneTextClass } from '@/components/status-tone'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { TeamPanelModel, TeamQueueEntry } from '../../../../shared/team-panel-model-types'
import { teamStatusTone } from './team-card-text'
import { TeamStatusMark } from './TeamStatusMark'

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
        <TeamStatusMark status={entry.status} />
        {stateText(entry)}
      </span>
    </a>
  )
}

// Why 4: V30's queueSection shows the next four; the rest are a merge away.
const QUEUE_SHOWN = 4

/** The merge queue's entries, when the model has any to show. */
export function teamQueueEntriesOf(model: Pick<TeamPanelModel, 'queue'>): TeamQueueEntry[] {
  return model.queue?.kind === 'ready' ? model.queue.value : []
}

/** V30's merge queue at the top of PRs: a count, the next four in order, then a rule. */
export function TeamPanelQueueSection({
  entries
}: {
  entries: readonly TeamQueueEntry[]
}): React.JSX.Element | null {
  if (entries.length === 0) {
    return null
  }
  return (
    <div className="flex flex-col border-b border-border pb-1.5">
      <span data-team-queue-title="" className="px-3 pb-1 pt-1.5 text-xs text-muted-foreground">
        {translate('teamPanel.prs.queueTitle', 'Merge queue · {{count}}', {
          count: entries.length
        })}
      </span>
      {entries.slice(0, QUEUE_SHOWN).map((entry) => (
        <QueueRow key={entry.url} entry={entry} />
      ))}
    </div>
  )
}

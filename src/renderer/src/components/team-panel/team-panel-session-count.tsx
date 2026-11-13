import { StatusDot } from '@/components/StatusDot'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { TeamActivityRow, TeamStatus } from '../../../../shared/team-panel-model-types'
import { teamStatusTone } from './team-card-text'
import { useTeamActivityFilter } from './team-activity-filter'

function needsYouText(count: number): string {
  return count === 1
    ? translate('teamPanel.activity.countNeedsYou_one', '{{count}} needs you', { count })
    : translate('teamPanel.activity.countNeedsYou_other', '{{count}} need you', { count })
}

function doneText(count: number): string {
  return count === 1
    ? translate('teamPanel.activity.countDone_one', '{{count}} done', { count })
    : translate('teamPanel.activity.countDone_other', '{{count}} done', { count })
}

const workingText = (count: number): string =>
  translate('teamPanel.activity.countWorking', '{{count}} working', { count })

/** A count that filters the session list to its own; a second press shows every session again. */
function Count({
  status,
  text,
  count
}: {
  status: TeamStatus
  text: string
  count: number
}): React.JSX.Element {
  const { filter, setFilter } = useTeamActivityFilter()
  const active = filter === status
  return (
    <button
      type="button"
      data-team-activity-filter={status}
      aria-pressed={active}
      disabled={count === 0 && !active}
      onClick={() => setFilter(active ? null : status)}
      className={cn(
        '-mx-1.5 inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default',
        active
          ? 'bg-sidebar-accent font-medium text-foreground'
          : 'hover:bg-sidebar-accent/60 hover:text-foreground disabled:hover:bg-transparent disabled:hover:text-muted-foreground'
      )}
    >
      <StatusDot tone={teamStatusTone(status)} />
      {text}
    </button>
  )
}

/** The state line under "Your work", on every tab; one session has nothing to sum up. */
export function TeamSessionCount({
  rows
}: {
  rows: readonly TeamActivityRow[]
}): React.JSX.Element | null {
  const { filter, setFilter } = useTeamActivityFilter()
  if (rows.length < 2) {
    return null
  }
  const count = (status: TeamStatus): number => rows.filter((row) => row.status === status).length
  const needsYou = count('attention')
  return (
    <div
      data-team-activity-count=""
      onKeyDown={(event) => {
        if (event.key === 'Escape' && filter) {
          event.stopPropagation()
          setFilter(null)
        }
      }}
      className="flex flex-wrap gap-x-3.5 gap-y-1 px-3 pb-2.5 text-xs text-muted-foreground"
    >
      {needsYou > 0 ? (
        <Count status="attention" text={needsYouText(needsYou)} count={needsYou} />
      ) : null}
      <Count status="working" text={workingText(count('working'))} count={count('working')} />
      <Count status="done" text={doneText(count('done'))} count={count('done')} />
    </div>
  )
}

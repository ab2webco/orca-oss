import { StatusDot } from '@/components/StatusDot'
import { translate } from '@/i18n/i18n'
import type { TeamActivityRow, TeamStatus } from '../../../../shared/team-panel-model-types'
import { teamStatusTone } from './team-card-text'

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

function Count({ status, text }: { status: TeamStatus; text: string }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5">
      <StatusDot tone={teamStatusTone(status)} />
      {text}
    </span>
  )
}

/** The state line under "Your work", on every tab; one session has nothing to sum up. */
export function TeamSessionCount({
  rows
}: {
  rows: readonly TeamActivityRow[]
}): React.JSX.Element | null {
  if (rows.length < 2) {
    return null
  }
  const count = (status: TeamStatus): number => rows.filter((row) => row.status === status).length
  const needsYou = count('attention')
  return (
    <div
      data-team-activity-count=""
      className="flex flex-wrap gap-x-3.5 gap-y-1 px-3 pb-2.5 text-xs text-muted-foreground"
    >
      {needsYou > 0 ? <Count status="attention" text={needsYouText(needsYou)} /> : null}
      <Count status="working" text={workingText(count('working'))} />
      <Count status="done" text={doneText(count('done'))} />
    </div>
  )
}

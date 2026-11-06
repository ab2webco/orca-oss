import { Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import type {
  TeamLeadAction,
  TeamLeadWork,
  TeamTodoHeading,
  TeamTodoList,
  TeamTodoRow
} from '../../../../shared/team-panel-lead-work'
import { useTeamLeadPrompt, type SendToLead } from './use-team-lead-prompt'

export type { SendToLead }

function headingText(heading: TeamTodoHeading): string {
  switch (heading) {
    case 'in_progress':
      return translate('teamPanel.leadWork.heading.inProgress', 'In progress')
    case 'review':
      return translate('teamPanel.leadWork.heading.review', 'QA / review')
    case 'todo':
      return translate('teamPanel.leadWork.heading.todo', 'To do')
    case 'backlog':
      return translate('teamPanel.leadWork.heading.backlog', 'Backlog')
    case 'other':
      return translate('teamPanel.leadWork.heading.other', 'Other')
  }
}

/** Orca's own buttons in the session language; a project's keep the label it wrote. */
function actionLabel(action: TeamLeadAction): string {
  switch (action.id) {
    case 'lead:wave':
      return translate('teamPanel.leadWork.action.wave', 'Wave')
    case 'lead:status':
      return translate('teamPanel.leadWork.action.status', 'Status')
    case 'lead:push':
      return translate('teamPanel.leadWork.action.push', 'Push')
    case 'lead:sweep':
      return translate('teamPanel.leadWork.action.sweep', 'Sweep')
    case 'lead:stop':
      return translate('teamPanel.leadWork.action.stop', 'Stop')
    default:
      return action.label
  }
}

function SectionTitle({
  title,
  count
}: {
  title: string
  count: number | null
}): React.JSX.Element {
  return (
    <h3 className="flex h-7 items-center gap-2 px-3 text-[12.5px] text-muted-foreground">
      <span className="font-medium text-foreground">{title}</span>
      {count === null ? null : <span className="tabular-nums">{count}</span>}
    </h3>
  )
}

function TodoRow({ row, send }: { row: TeamTodoRow; send: SendToLead | null }): React.JSX.Element {
  const { prompt } = row
  const label = translate('teamPanel.leadWork.workOn', 'Work on {{id}}', { id: row.id })
  return (
    <div
      data-team-todo={row.id}
      className="flex min-h-[34px] min-w-0 items-center gap-1 pr-1.5 text-[12.5px] hover:bg-sidebar-accent"
    >
      <a
        href={row.url}
        target="_blank"
        rel="noreferrer"
        className="flex min-h-[34px] min-w-0 flex-1 items-center gap-2 pl-3"
      >
        <code className="flex-none font-mono text-xs">{row.id}</code>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{row.title}</span>
      </a>
      {send && prompt ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              aria-label={label}
              onClick={() => send(`work-${row.id}`, prompt, label)}
            >
              <Play />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left" sideOffset={6}>
            {label}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )
}

const MORE_CLASS =
  'px-3 py-2 text-left text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline'

function TodoMore({
  list,
  send
}: {
  list: TeamTodoList
  send: SendToLead | null
}): React.JSX.Element | null {
  const { listAction, listUrl, hidden, total } = list
  if (hidden === 0) {
    return null
  }
  const viewAll = translate('teamPanel.leadWork.viewAll', 'View all {{count}}', { count: total })
  if (listAction && send) {
    return (
      <button
        type="button"
        data-team-todo-more=""
        className={MORE_CLASS}
        onClick={() => send(listAction.id, listAction.prompt, actionLabel(listAction))}
      >
        {viewAll}
      </button>
    )
  }
  if (listUrl) {
    return (
      <a
        data-team-todo-more=""
        href={listUrl}
        target="_blank"
        rel="noreferrer"
        className={MORE_CLASS}
      >
        {viewAll}
      </a>
    )
  }
  return (
    <p data-team-todo-more="" className="px-3 py-2 text-xs text-muted-foreground">
      {translate('teamPanel.leadWork.more', '+{{count}} more', { count: hidden })}
    </p>
  )
}

function TodoSection({
  list,
  send
}: {
  list: TeamTodoList
  send: SendToLead | null
}): React.JSX.Element {
  return (
    <section data-team-todo-list="" className="flex flex-col pt-1.5">
      <SectionTitle title={translate('teamPanel.leadWork.todo', 'To Do')} count={list.total} />
      {list.groups.length === 0 ? (
        <p className="px-3 pb-1.5 text-xs text-muted-foreground">
          {translate('teamPanel.leadWork.todoEmpty', 'Nothing to do')}
        </p>
      ) : null}
      {list.groups.map((group) => (
        <div key={group.heading ?? 'all'} className="flex flex-col">
          {group.heading ? (
            <h4
              data-team-todo-heading={group.heading}
              className="flex h-6 items-center gap-1.5 px-3 text-[11.5px] text-muted-foreground"
            >
              {headingText(group.heading)}
              {group.count === null ? null : <span className="tabular-nums">{group.count}</span>}
            </h4>
          ) : null}
          {group.rows.map((row) => (
            <TodoRow key={row.id} row={row} send={send} />
          ))}
        </div>
      ))}
      <TodoMore list={list} send={send} />
    </section>
  )
}

function ActionsSection({
  actions,
  send
}: {
  actions: readonly TeamLeadAction[]
  send: SendToLead
}): React.JSX.Element {
  return (
    <section data-team-actions="" className="flex flex-col pt-1.5">
      <SectionTitle title={translate('teamPanel.leadWork.actions', 'Actions')} count={null} />
      <div className="flex flex-wrap gap-1.5 px-3 pt-0.5">
        {actions.map((action) => {
          const label = actionLabel(action)
          return (
            <Button
              key={action.id}
              data-team-action={action.id}
              variant="outline"
              size="xs"
              onClick={() => send(action.id, action.prompt, label)}
            >
              {label}
            </Button>
          )
        })}
      </div>
    </section>
  )
}

/** With no lead pane to write to, `send` is null: tickets stay as links and buttons go. */
export function TeamLeadWorkSections({
  work,
  send
}: {
  work: TeamLeadWork
  send: SendToLead | null
}): React.JSX.Element | null {
  const { todo, actions } = work
  const showActions = send !== null && actions.length > 0
  if (!todo && !showActions) {
    return null
  }
  return (
    <div data-team-lead-work="" className="flex flex-col border-t border-border pb-3">
      {todo ? <TodoSection list={todo} send={send} /> : null}
      {showActions ? <ActionsSection actions={actions} send={send} /> : null}
    </div>
  )
}

/** To Do and Actions, as one piece so their place in the panel moves with one line. */
export function TeamPanelLeadWork({ work }: { work: TeamLeadWork }): React.JSX.Element | null {
  return <TeamLeadWorkSections work={work} send={useTeamLeadPrompt()} />
}

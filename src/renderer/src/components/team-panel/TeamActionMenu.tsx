import { useState } from 'react'
import { Ellipsis, Plus, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { TeamAction } from '../../../../shared/team-panel-actions'
import { TeamActionIcon } from './team-action-icons'
import { teamActionHint, teamActionLabel, teamActionOffText } from './team-action-words'

export type TeamActionMenuProps = {
  actions: TeamAction[]
  /** While the lead works on a run, nothing else may start. */
  disabled: boolean
  onRun: (action: TeamAction) => void
  /** Stop asks first, in the dock. */
  onStop: () => void
  onNewAction: () => void
  onEditActions: () => void
  /** The dock, which the menu spans; the trigger when absent. */
  anchor?: React.RefObject<HTMLElement | null>
}

const ROW =
  'flex min-h-[30px] w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12.5px] hover:bg-muted disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent'

function MenuRow({
  action,
  disabled,
  onPick
}: {
  action: TeamAction
  disabled: boolean
  onPick: () => void
}): React.JSX.Element {
  const right = action.now
    ? teamActionHint(action)
    : action.off
      ? teamActionOffText(action.off)
      : action.command
        ? `/${action.command}`
        : ''
  return (
    <button
      type="button"
      role="menuitem"
      className={ROW}
      disabled={disabled || action.off !== null}
      onClick={onPick}
    >
      <TeamActionIcon icon={action.icon} className="text-muted-foreground/70" />
      <span
        className={cn('min-w-0 flex-1 truncate', action.orca === 'stop' && 'text-status-attention')}
      >
        {teamActionLabel(action)}
      </span>
      <em className="ml-auto whitespace-nowrap text-[11.5px] not-italic text-muted-foreground/70">
        {right}
      </em>
    </button>
  )
}

export function TeamActionMenu({
  actions,
  disabled,
  onRun,
  onStop,
  onNewAction,
  onEditActions,
  anchor
}: TeamActionMenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const hit = (one: TeamAction): boolean =>
    !q || teamActionLabel(one).toLowerCase().includes(q) || (one.command ?? '').includes(q)
  const groups: [string, TeamAction[]][] = [
    [translate('teamPanel.actions.menu.now', 'Now'), actions.filter((one) => one.now && hit(one))],
    [
      translate('teamPanel.actions.menu.project', 'This project'),
      actions.filter((one) => one.orca === null && hit(one))
    ],
    [
      translate('teamPanel.actions.menu.orca', 'From Orca'),
      actions.filter((one) => one.orca !== null && !one.now && hit(one))
    ]
  ]
  const pick = (one: TeamAction): void => {
    setOpen(false)
    if (one.orca === 'stop') {
      onStop()
    } else {
      onRun(one)
    }
  }
  const leave = (then: () => void) => () => {
    setOpen(false)
    then()
  }
  const label = translate('teamPanel.actions.menu.label', 'All actions')
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        setQuery('')
      }}
    >
      {/* Why the key: a fresh anchor on each open re-points Radix at the dock; StrictMode's ref
          replay otherwise leaves it on the first trigger, detached since. */}
      {anchor ? (
        <PopoverAnchor key={String(open)} virtualRef={anchor as React.RefObject<HTMLElement>} />
      ) : null}
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          className="size-7 text-muted-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground"
          aria-label={label}
        >
          <Ellipsis className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        sideOffset={6}
        role="menu"
        aria-label={label}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="flex max-h-[min(440px,62vh)] w-[calc(var(--radix-popper-anchor-width)-16px)] min-w-[200px] flex-col p-0"
      >
        <input
          type="search"
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={translate('teamPanel.actions.menu.search', 'Search actions')}
          aria-label={translate('teamPanel.actions.menu.search', 'Search actions')}
          className="mx-2 mb-1 mt-2 flex-none rounded-md border border-border bg-background px-2 py-1.5 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        <div className="min-h-0 flex-1 overflow-auto px-2 pb-1.5 scrollbar-sleek">
          {groups.every(([, list]) => list.length === 0) ? (
            <p className="mx-2 my-3 text-xs text-muted-foreground">
              {translate('teamPanel.actions.menu.none', 'No action with that name.')}
            </p>
          ) : (
            groups.map(([title, list]) =>
              list.length === 0 ? null : (
                <div key={title}>
                  <h4 className="mx-2 mb-1 mt-2 text-[11.5px] font-medium text-muted-foreground/70">
                    {title}
                  </h4>
                  {list.map((one) => (
                    <MenuRow
                      key={one.id}
                      action={one}
                      disabled={disabled}
                      onPick={() => pick(one)}
                    />
                  ))}
                </div>
              )
            )
          )}
        </div>
        <div className="flex flex-none gap-0.5 border-t border-border px-2 pb-2 pt-1">
          <button
            type="button"
            className={cn(ROW, 'flex-1 text-muted-foreground')}
            onClick={leave(onNewAction)}
          >
            <Plus className="size-3.5" aria-hidden />
            <span className="min-w-0 truncate">
              {translate('teamPanel.actions.menu.new', 'New action')}
            </span>
          </button>
          <button
            type="button"
            className={cn(ROW, 'flex-1 text-muted-foreground')}
            onClick={leave(onEditActions)}
          >
            <Settings2 className="size-3.5" aria-hidden />
            <span className="min-w-0 truncate">
              {translate('teamPanel.actions.menu.edit', 'Edit')}
            </span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

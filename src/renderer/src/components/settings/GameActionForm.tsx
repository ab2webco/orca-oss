import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { SettingsSegmentedControl } from './SettingsFormControls'
import type { ActionDraft, ActionDraftProblem } from './orchestrator-game-action-drafts'
import { GAME_ACTION_PICKER_ICONS, actionCommandOf } from './orchestrator-game-action-list'
import { TeamActionIcon } from '../team-panel/team-action-icons'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'

/** What the form edits: a project action, or one of Orca's whose command and kind are fixed. */
export type GameActionFormState = {
  draft: ActionDraft
  isNew: boolean
  orca: boolean
  /** Until the person types a command, it follows the name. */
  commandTouched: boolean
}

export function gameActionProblemText(problem: ActionDraftProblem, command: string): string {
  switch (problem) {
    case 'label':
      return translate('settings.gameActions.problem.label', 'Give the button a name.')
    case 'command':
      return translate(
        'settings.gameActions.problem.command',
        'The command is lowercase, with no spaces, and starts with a letter.'
      )
    case 'commandTaken':
      return translate(
        'settings.gameActions.problem.commandTaken',
        '/{{command}} already exists.',
        {
          command
        }
      )
    case 'prompt':
      return translate('settings.gameActions.problem.prompt', 'Write what it asks the lead.')
    case 'mcp':
      return translate('settings.gameActions.problem.mcp', 'Name the MCP server and tool.')
    case 'args':
    case 'key':
      return translate(
        'settings.gameActions.problem.hidden',
        'Its arguments or key in orca.yaml are not valid; fix them there.'
      )
  }
}

const labelClass = 'flex min-w-0 flex-col gap-1 text-xs text-muted-foreground'

export function GameActionForm({
  state,
  problem,
  onChange,
  onSave,
  onCancel,
  onRemove
}: {
  state: GameActionFormState
  problem: ActionDraftProblem | null
  onChange: (next: GameActionFormState) => void
  onSave: () => void
  onCancel: () => void
  onRemove: (() => void) | null
}): React.JSX.Element {
  const { draft, orca } = state
  const set = (patch: Partial<ActionDraft>, commandTouched = state.commandTouched): void =>
    onChange({ ...state, draft: { ...draft, ...patch }, commandTouched })
  const setLabel = (label: string): void =>
    set(state.commandTouched || orca ? { label } : { label, command: actionCommandOf(label) })
  return (
    <div
      data-slot="game-action-form"
      className="mb-2 mt-0.5 flex flex-col gap-2.5 rounded-lg bg-muted/50 p-3"
    >
      <div className="flex min-h-11 items-center gap-2 rounded-md bg-background p-2 text-xs text-muted-foreground">
        <span>{translate('settings.gameActions.preview', 'Preview')}</span>
        <span className="inline-flex h-7 items-center gap-1.5 rounded-md bg-muted px-2 font-medium text-foreground">
          <TeamActionIcon icon={draft.icon} className="text-muted-foreground" />
          <span>
            {draft.label || translate('settings.gameActions.namePlaceholderShort', 'Name')}
          </span>
        </span>
        <span className="ml-auto font-mono text-[11px]">
          /{draft.command || translate('settings.gameActions.previewCommand', 'command')}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <label className={labelClass}>
          {translate('settings.gameActions.name', 'Button name')}
          <Input
            value={draft.label}
            maxLength={24}
            placeholder={translate('settings.gameActions.namePlaceholder', 'Deploy')}
            aria-invalid={problem === 'label'}
            className="h-8 text-xs text-foreground md:text-xs"
            onChange={(event) => setLabel(event.currentTarget.value)}
          />
        </label>
        <label className={labelClass}>
          {translate('settings.gameActions.command', 'Command')}
          <Input
            value={draft.command}
            maxLength={24}
            placeholder={translate('settings.gameActions.commandPlaceholder', 'deploy')}
            readOnly={orca}
            aria-invalid={problem === 'command' || problem === 'commandTaken'}
            className="h-8 font-mono text-xs text-foreground md:text-xs"
            onChange={(event) => set({ command: event.currentTarget.value }, true)}
          />
        </label>
      </div>
      <div
        role="radiogroup"
        aria-label={translate('settings.gameActions.icon', 'Icon')}
        className="flex flex-wrap gap-0.5"
      >
        {GAME_ACTION_PICKER_ICONS.map((icon) => (
          <button
            key={icon}
            type="button"
            role="radio"
            aria-checked={draft.icon === icon}
            aria-label={`${translate('settings.gameActions.icon', 'Icon')} ${icon}`}
            className={cn(
              'grid size-[30px] place-items-center rounded-md text-muted-foreground hover:bg-muted',
              draft.icon === icon && 'bg-accent text-foreground'
            )}
            onClick={() => set({ icon })}
          >
            <TeamActionIcon icon={icon} className="size-[15px]" />
          </button>
        ))}
      </div>
      {orca ? null : (
        // Why a wrapper: the form is a column, which would stretch the control across it.
        <div className="self-start">
          <SettingsSegmentedControl
            value={draft.kind}
            size="sm"
            ariaLabel={translate('settings.gameActions.kind', 'What it does')}
            options={[
              {
                value: 'prompt',
                label: translate('settings.gameActions.kindLead', 'Ask the lead')
              },
              { value: 'mcp', label: translate('settings.gameActions.kindMcp', 'MCP tool') }
            ]}
            onChange={(kind) => set({ kind })}
          />
        </div>
      )}
      {draft.kind === 'prompt' ? (
        <label className={labelClass}>
          {translate('settings.gameActions.prompt', 'What it asks the lead')}
          <Textarea
            value={draft.prompt}
            maxLength={2000}
            rows={3}
            aria-invalid={problem === 'prompt'}
            placeholder={translate(
              'settings.gameActions.promptPlaceholder',
              'What it should run and what it should report'
            )}
            className="min-h-16 text-xs text-foreground md:text-xs"
            onChange={(event) => set({ prompt: event.currentTarget.value })}
          />
        </label>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <label className={labelClass}>
            {translate('settings.gameActions.server', 'MCP server')}
            <Input
              value={draft.server}
              placeholder={translate('settings.gameActions.serverPlaceholder', 'plane')}
              aria-invalid={problem === 'mcp'}
              className="h-8 font-mono text-xs text-foreground md:text-xs"
              onChange={(event) => set({ server: event.currentTarget.value })}
            />
          </label>
          <label className={labelClass}>
            {translate('settings.gameActions.tool', 'Tool')}
            <Input
              value={draft.tool}
              placeholder={translate('settings.gameActions.toolPlaceholder', 'list_work_items')}
              aria-invalid={problem === 'mcp'}
              className="h-8 font-mono text-xs text-foreground md:text-xs"
              onChange={(event) => set({ tool: event.currentTarget.value })}
            />
          </label>
        </div>
      )}
      {problem ? (
        <p role="alert" className="m-0 text-xs text-destructive">
          {gameActionProblemText(problem, draft.command.trim())}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" className="h-7" onClick={onSave}>
          {state.isNew
            ? translate('settings.gameActions.create', 'Create action')
            : translate('settings.gameActions.save', 'Save')}
        </Button>
        <Button variant="ghost" size="sm" className="h-7" onClick={onCancel}>
          {translate('settings.gameActions.cancel', 'Cancel')}
        </Button>
        {onRemove ? (
          <Button variant="ghost" size="sm" className="h-7" onClick={onRemove}>
            {translate('settings.gameActions.remove', 'Remove')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

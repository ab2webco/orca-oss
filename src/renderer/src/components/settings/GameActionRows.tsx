import { Switch } from '../ui/switch'
import { TeamActionIcon } from '../team-panel/team-action-icons'
import { teamActionLabel } from '../team-panel/team-action-words'
import type { ActionDraft } from './orchestrator-game-action-drafts'
import type { OrcaActionRow } from './orchestrator-game-action-list'
import type { GameOrcaActionId } from '../../../../shared/orchestrator-game-orca-actions'
import { translate } from '@/i18n/i18n'

// Why a constant: a file name, never translated.
const ORCA_YAML = 'orca.yaml'
const ROW = 'flex items-center gap-2.5 border-t border-border py-2 text-[13px]'
const EDIT =
  'flex-none text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground'

export function ProjectActionRow({
  draft,
  first,
  source,
  onUp,
  onEdit,
  onPin
}: {
  draft: ActionDraft
  first: boolean
  source: string
  onUp: () => void
  onEdit: () => void
  onPin: () => void
}): React.JSX.Element {
  const what =
    draft.kind === 'mcp'
      ? `MCP ${draft.server}`
      : translate('settings.gameActions.kindLead', 'Ask the lead')
  return (
    <div data-slot="game-action-row" className={ROW}>
      <button
        type="button"
        aria-label={translate('settings.gameActions.moveUp', 'Move {{label}} up', {
          label: draft.label
        })}
        disabled={first}
        className="size-[26px] flex-none rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
        onClick={onUp}
      >
        ↑
      </button>
      <TeamActionIcon icon={draft.icon} className="size-[15px] text-muted-foreground/70" />
      <div className="min-w-0 flex-1">
        <b className="block font-medium">{draft.label}</b>
        {/* Why it wraps at the dot: V30 shows the command line whole, never cut short. */}
        <small className="block text-xs break-words text-muted-foreground">
          {draft.command ? `/${draft.command} ` : null}
          <span className="whitespace-nowrap">{draft.command ? `· ${what}` : what}</span>
        </small>
      </div>
      <span className="hidden flex-none font-mono text-[11px] text-muted-foreground sm:inline">
        {source}
      </span>
      <button type="button" className={EDIT} onClick={onEdit}>
        {translate('settings.gameActions.edit', 'Edit')}
      </button>
      <Switch
        checked={draft.pin}
        aria-label={translate('settings.gameActions.pin', 'Show {{label}} in the row', {
          label: draft.label
        })}
        title={translate('settings.gameActions.pinTitle', 'In the row')}
        onCheckedChange={onPin}
      />
    </div>
  )
}

/** An orca.yaml action hidden on this machine: still listed, dimmed, with 'Show' to bring it back. */
export function HiddenProjectActionRow({
  draft,
  onShow
}: {
  draft: ActionDraft
  onShow: () => void
}): React.JSX.Element {
  return (
    <div data-slot="game-action-row" data-hidden="" className={ROW}>
      {/* Why: keeps the icon and words in line with the rows that have ↑. */}
      <span aria-hidden className="size-[26px] flex-none" />
      <TeamActionIcon icon={draft.icon} className="size-[15px] text-muted-foreground/50" />
      <div className="min-w-0 flex-1 opacity-60">
        <b className="block font-medium">{draft.label}</b>
        <small className="block text-xs break-words text-muted-foreground">
          {draft.command ? `/${draft.command} ` : null}
          <span className="whitespace-nowrap">
            {`· ${translate('settings.gameActions.hiddenHere', 'Hidden on this machine')}`}
          </span>
        </small>
      </div>
      <span className="hidden flex-none font-mono text-[11px] text-muted-foreground opacity-60 sm:inline">
        {ORCA_YAML}
      </span>
      <button type="button" className={EDIT} onClick={onShow}>
        {translate('settings.gameActions.show', 'Show')}
      </button>
      <Switch
        checked={draft.pin}
        disabled
        aria-label={translate('settings.gameActions.pin', 'Show {{label}} in the row', {
          label: draft.label
        })}
        title={translate('settings.gameActions.pinTitle', 'In the row')}
      />
    </div>
  )
}

function orcaCondition(id: GameOrcaActionId): string {
  switch (id) {
    case 'wave':
      return translate('settings.gameActions.when.wave', 'When there is To Do and free slots.')
    case 'push':
      return translate('settings.gameActions.when.push', 'When members are stopped.')
    case 'sweep':
      return translate(
        'settings.gameActions.when.sweep',
        'When finished members wait to be closed.'
      )
    case 'status':
      return translate('settings.gameActions.when.status', 'Always, in the menu.')
    case 'stop':
      return translate('settings.gameActions.when.stop', 'Always, with confirmation.')
  }
}

export function OrcaActionSettingsRow({
  row,
  onEdit,
  onToggle
}: {
  row: OrcaActionRow
  onEdit: () => void
  onToggle: () => void
}): React.JSX.Element {
  const label = teamActionLabel({ orca: row.id, label: row.label })
  return (
    <div data-slot="game-action-row" className={ROW}>
      <TeamActionIcon icon={row.icon} className="size-[15px] text-muted-foreground/70" />
      <div className="min-w-0 flex-1">
        <b className="block font-medium">{label}</b>
        <small className="block truncate text-xs text-muted-foreground">
          {orcaCondition(row.id)}
        </small>
      </div>
      <button type="button" className={EDIT} onClick={onEdit}>
        {translate('settings.gameActions.edit', 'Edit')}
      </button>
      {/* Why no switch on Stop: it can never be turned off. */}
      {row.id === 'stop' ? null : (
        <Switch
          checked={row.enabled}
          aria-label={translate('settings.gameActions.enable', 'Turn on {{label}}', { label })}
          onCheckedChange={onToggle}
        />
      )}
    </div>
  )
}

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  GAME_ACTIONS_MAX,
  parseGameActions,
  type OrchestratorGameAction
} from '../../../../shared/orchestrator-game-actions'
import type { OrchestratorGameLayer } from '../../../../shared/orchestrator-game-config'
import { withOrchestratorGameProjectActions } from '../../../../shared/orchestrator-game-settings-updates'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { SettingsSegmentedControl, SettingsSubsectionHeader } from './SettingsFormControls'
import {
  EMPTY_ACTION_DRAFT,
  actionDraftOf,
  actionsOfDrafts,
  type ActionDraft,
  type ActionDraftProblem
} from './orchestrator-game-action-drafts'
import { translate } from '@/i18n/i18n'

type GameSettings = Pick<GlobalSettings, 'orchestratorGameProjects'>

const problemText = (problem: ActionDraftProblem): string =>
  ({
    label: translate(
      'auto.components.settings.OrchestratorGameActionsSetting.labelInvalid',
      'Use 1 to 24 characters.'
    ),
    command: translate(
      'auto.components.settings.OrchestratorGameActionsSetting.commandInvalid',
      'Use a lowercase name like test-runs, up to 24 characters.'
    ),
    commandTaken: translate(
      'auto.components.settings.OrchestratorGameActionsSetting.commandTaken',
      'A lead button or another action already uses this command.'
    ),
    key: translate(
      'auto.components.settings.OrchestratorGameActionsSetting.keyInvalid',
      'Use one letter or digit the Panel does not use (r p q g t i o c w a, 1-9), once per action.'
    ),
    prompt: translate(
      'auto.components.settings.OrchestratorGameActionsSetting.promptInvalid',
      'Write a prompt of 1 to 2000 characters, with only the placeholders orca.yaml allows.'
    ),
    mcp: translate(
      'auto.components.settings.OrchestratorGameActionsSetting.mcpInvalid',
      'Name the MCP server and a tool like list_test_runs.'
    ),
    args: translate(
      'auto.components.settings.OrchestratorGameActionsSetting.argsInvalid',
      'Arguments must be a JSON object, like {"project": "CIN"}.'
    )
  })[problem]

const PROBLEM_FIELDS = new Map<ActionDraftProblem, readonly (keyof ActionDraft)[]>([
  ['label', ['label']],
  ['command', ['command']],
  ['commandTaken', ['command']],
  ['key', ['key']],
  ['prompt', ['prompt']],
  ['mcp', ['server', 'tool']],
  ['args', ['args']]
])

const summaryOf = (action: OrchestratorGameAction): string =>
  'prompt' in action ? action.prompt : `${action.mcp.server} · ${action.mcp.tool}`

function ActionRow({
  draft,
  index,
  problem,
  onChange,
  onRemove
}: {
  draft: ActionDraft
  index: number
  problem: ActionDraftProblem | null
  onChange: (next: ActionDraft) => void
  onRemove: () => void
}): React.JSX.Element {
  const n = index + 1
  const field = (key: keyof ActionDraft, label: string, placeholder: string, mono = false) => (
    <Input
      aria-label={`${label} ${n}`}
      aria-invalid={problem !== null && (PROBLEM_FIELDS.get(problem) ?? []).includes(key)}
      value={draft[key]}
      placeholder={placeholder}
      spellCheck={false}
      className={`h-8 min-w-0 text-xs md:text-xs ${mono ? 'font-mono' : ''}`}
      onChange={(event) => onChange({ ...draft, [key]: event.currentTarget.value })}
    />
  )
  return (
    <div data-slot="game-action-row" className="space-y-2 rounded-md border border-border p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        {field(
          'label',
          translate('auto.components.settings.OrchestratorGameActionsSetting.label', 'Label'),
          translate(
            'auto.components.settings.OrchestratorGameActionsSetting.labelPlaceholder',
            'Test runs'
          )
        )}
        <div className="flex min-w-0 items-center gap-1">
          <span className="text-xs text-muted-foreground">/</span>
          {/* Why a flex-1 wrapper: beside the fixed key box the input would shrink to nothing. */}
          <div className="min-w-0 flex-1">
            {field(
              'command',
              translate(
                'auto.components.settings.OrchestratorGameActionsSetting.command',
                'Command'
              ),
              translate(
                'auto.components.settings.OrchestratorGameActionsSetting.commandPlaceholder',
                'test-runs'
              ),
              true
            )}
          </div>
          <div className="w-12 shrink-0">
            {field(
              'key',
              translate('auto.components.settings.OrchestratorGameActionsSetting.key', 'Key'),
              translate(
                'auto.components.settings.OrchestratorGameActionsSetting.keyPlaceholder',
                'x'
              ),
              true
            )}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 sm:col-span-2 xl:col-span-1">
          <SettingsSegmentedControl
            value={draft.kind}
            ariaLabel={`${translate('auto.components.settings.OrchestratorGameActionsSetting.kind', 'Kind')} ${n}`}
            size="sm"
            options={[
              {
                value: 'prompt',
                label: translate(
                  'auto.components.settings.OrchestratorGameActionsSetting.kindPrompt',
                  'Prompt'
                )
              },
              {
                value: 'mcp',
                label: translate(
                  'auto.components.settings.OrchestratorGameActionsSetting.kindMcp',
                  'MCP'
                )
              }
            ]}
            onChange={(kind) => onChange({ ...draft, kind })}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`${translate('auto.components.settings.OrchestratorGameActionsSetting.remove', 'Remove action')} ${n}`}
            onClick={onRemove}
          >
            <Trash2 />
          </Button>
        </div>
      </div>
      {draft.kind === 'prompt' ? (
        <Textarea
          aria-label={`${translate('auto.components.settings.OrchestratorGameActionsSetting.prompt', 'Prompt')} ${n}`}
          aria-invalid={problem === 'prompt'}
          value={draft.prompt}
          rows={2}
          placeholder={translate(
            'auto.components.settings.OrchestratorGameActionsSetting.promptPlaceholder',
            'Have members run the Tambora test runs of my QA tickets'
          )}
          className="min-h-14 text-xs md:text-xs"
          onChange={(event) => onChange({ ...draft, prompt: event.currentTarget.value })}
        />
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {field(
            'server',
            translate(
              'auto.components.settings.OrchestratorGameActionsSetting.server',
              'MCP server'
            ),
            'tambora'
          )}
          {field(
            'tool',
            translate('auto.components.settings.OrchestratorGameActionsSetting.tool', 'Tool'),
            'list_test_runs',
            true
          )}
          <div className="sm:col-span-2">
            {field(
              'args',
              translate(
                'auto.components.settings.OrchestratorGameActionsSetting.args',
                'Arguments (JSON)'
              ),
              '{"project": "CIN"}',
              true
            )}
          </div>
        </div>
      )}
      {problem !== null ? (
        <p role="alert" className="text-xs text-destructive">
          {problemText(problem)}
        </p>
      ) : null}
    </div>
  )
}

type Row = { id: number; draft: ActionDraft }

let nextRowId = 0
const rowsOf = (drafts: readonly ActionDraft[]): Row[] =>
  drafts.map((draft) => ({ id: (nextRowId += 1), draft }))

/** This machine's actions for the project; a saved list replaces orca.yaml's whole. */
export function ProjectOrchestratorGameActionsSetting({
  repoId,
  settings,
  projectLayer,
  updateSettings
}: {
  repoId: string
  settings: GameSettings
  projectLayer: OrchestratorGameLayer | undefined
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element {
  const rawLocal = settings.orchestratorGameProjects?.[repoId]?.actions
  const local = rawLocal === undefined ? undefined : (parseGameActions(rawLocal).value ?? [])
  const yaml = projectLayer?.actions ?? []
  // Why ids: a removed row must take its own inputs with it, not shift the next row's into place.
  const [rows, setRows] = useState<Row[] | null>(
    local === undefined ? null : rowsOf(local.map(actionDraftOf))
  )
  const drafts = rows?.map((row) => row.draft) ?? null
  const { actions, problems } = actionsOfDrafts(drafts ?? [])
  const saved = JSON.stringify(local ?? null)
  const save = (next: OrchestratorGameAction[] | undefined): void =>
    updateSettings({
      orchestratorGameProjects: withOrchestratorGameProjectActions(
        settings.orchestratorGameProjects,
        repoId,
        next
      )
    })
  const inherit = (): void => {
    setRows(null)
    if (local !== undefined) {
      save(undefined)
    }
  }

  return (
    <div data-slot="game-actions-settings" className="space-y-2 pt-3">
      <SettingsSubsectionHeader
        title={translate(
          'auto.components.settings.OrchestratorGameActionsSetting.title',
          'Actions'
        )}
        description={translate(
          'auto.components.settings.OrchestratorGameActionsSetting.description',
          'Buttons in the band and the Panel, each also a slash command. A list saved here replaces the one in orca.yaml on this machine.'
        )}
      />
      {drafts === null ? (
        <div className="space-y-2">
          {yaml.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.settings.OrchestratorGameActionsSetting.yamlEmpty',
                'orca.yaml sets no actions for this project.'
              )}
            </p>
          ) : (
            <ul
              className="space-y-1"
              aria-label={translate(
                'auto.components.settings.OrchestratorGameActionsSetting.yamlList',
                'Actions from orca.yaml'
              )}
            >
              {yaml.map((action, at) => (
                <li
                  key={`${action.label}-${at}`}
                  className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-xs"
                >
                  <span className="font-medium">{action.label}</span>
                  {action.command ? (
                    <span className="font-mono text-muted-foreground">/{action.command}</span>
                  ) : null}
                  <span className="min-w-0 truncate text-muted-foreground">
                    {summaryOf(action)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRows(rowsOf(yaml.map(actionDraftOf)))}
          >
            {translate(
              'auto.components.settings.OrchestratorGameActionsSetting.override',
              'Edit on this machine'
            )}
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {(rows ?? []).map((row, index) => (
            <ActionRow
              key={row.id}
              draft={row.draft}
              index={index}
              problem={problems[index] ?? null}
              onChange={(next) =>
                setRows(
                  (rows ?? []).map((one) => (one.id === row.id ? { ...one, draft: next } : one))
                )
              }
              onRemove={() => setRows((rows ?? []).filter((one) => one.id !== row.id))}
            />
          ))}
          {drafts.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.settings.OrchestratorGameActionsSetting.noneHere',
                'No actions on this machine.'
              )}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={drafts.length >= GAME_ACTIONS_MAX}
              onClick={() => setRows([...(rows ?? []), ...rowsOf([EMPTY_ACTION_DRAFT])])}
            >
              <Plus />
              {translate(
                'auto.components.settings.OrchestratorGameActionsSetting.add',
                'Add action'
              )}
            </Button>
            <Button
              size="sm"
              disabled={actions === null || JSON.stringify(actions) === saved}
              onClick={() => actions !== null && save(actions)}
            >
              {translate(
                'auto.components.settings.OrchestratorGameActionsSetting.save',
                'Save actions'
              )}
            </Button>
            <Button variant="ghost" size="sm" onClick={inherit}>
              {translate(
                'auto.components.settings.OrchestratorGameActionsSetting.inherit',
                'Inherit from orca.yaml'
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

import { useState } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { GAME_ACTIONS_MAX, parseGameActions } from '../../../../shared/orchestrator-game-actions'
import type { OrchestratorGameLayer } from '../../../../shared/orchestrator-game-config'
import {
  parseGameOrcaActions,
  type GameOrcaActionId
} from '../../../../shared/orchestrator-game-orca-actions'
import {
  withOrchestratorGameProjectActions,
  withOrchestratorGameProjectOrcaActions
} from '../../../../shared/orchestrator-game-settings-updates'
import { Button } from '../ui/button'
import { TeamActionIcon } from '../team-panel/team-action-icons'
import { useTeamLeadPrompt } from '../team-panel/use-team-lead-prompt'
import { GameActionForm, type GameActionFormState } from './GameActionForm'
import { OrcaActionSettingsRow, ProjectActionRow } from './GameActionRows'
import {
  EMPTY_ACTION_DRAFT,
  actionDraftOf,
  actionsOfDrafts,
  type ActionDraft,
  type ActionDraftProblem
} from './orchestrator-game-action-drafts'
import {
  isCommandTaken,
  movedUp,
  orcaActionRowsOf,
  withNewActionFirst,
  withOrcaEnabled,
  withOrcaWords,
  withPinToggled
} from './orchestrator-game-action-list'
import { gameActionTemplates } from './orchestrator-game-action-templates'
import { takeNewGameActionRequest } from './game-actions-settings-intent'
import { getRepositoryGameActionsSectionId } from './repository-settings-targets'
import { translate } from '@/i18n/i18n'

type GameSettings = Pick<GlobalSettings, 'orchestratorGameProjects'>
type Target = number | 'new' | GameOrcaActionId
type Form = { target: Target; state: GameActionFormState }

const HEAD = 'mb-0.5 mt-4 text-xs font-medium text-muted-foreground/70'

/** Prototype V30's Settings > Actions: the project's buttons and Orca's, saved on this machine. */
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
  const localLayer = settings.orchestratorGameProjects?.[repoId]
  const local =
    localLayer?.actions === undefined
      ? undefined
      : (parseGameActions(localLayer.actions).value ?? [])
  const list = (local ?? projectLayer?.actions ?? []).map(actionDraftOf)
  const source =
    local === undefined ? 'orca.yaml' : translate('settings.gameActions.machine', 'This machine')
  const localOrca = parseGameOrcaActions(localLayer?.orcaActions).value
  const orcaRows = orcaActionRowsOf(projectLayer?.orcaActions, localOrca)
  // Why a lazy initial state: the dock's request is read once, on the first render.
  const [form, setForm] = useState<Form | null>(() =>
    takeNewGameActionRequest(repoId)
      ? {
          target: 'new',
          state: { draft: EMPTY_ACTION_DRAFT, isNew: true, orca: false, commandTouched: false }
        }
      : null
  )
  const [problem, setProblem] = useState<ActionDraftProblem | null>(null)
  const [pinFull, setPinFull] = useState(false)
  const sendToLead = useTeamLeadPrompt()

  const saveList = (drafts: ActionDraft[], at: number): boolean => {
    const { actions, problems } = actionsOfDrafts(drafts)
    if (actions === null) {
      setProblem(problems[at] ?? problems.find((one) => one !== null) ?? null)
      return false
    }
    updateSettings({
      orchestratorGameProjects: withOrchestratorGameProjectActions(
        settings.orchestratorGameProjects,
        repoId,
        actions
      )
    })
    return true
  }
  const open = (target: Target, draft: ActionDraft, orca = false): void => {
    setProblem(null)
    const isNew = target === 'new'
    setForm({
      target,
      state: { draft, isNew, orca, commandTouched: !isNew || draft.command !== '' }
    })
  }
  const save = (): void => {
    if (!form) {
      return
    }
    const { target, state } = form
    if (typeof target === 'string' && target !== 'new') {
      const next = withOrcaWords(localOrca, target, state.draft)
      if (next === 'prompt' || next === 'label') {
        setProblem(next)
        return
      }
      updateSettings({
        orchestratorGameProjects: withOrchestratorGameProjectOrcaActions(
          settings.orchestratorGameProjects,
          repoId,
          next
        )
      })
      setForm(null)
      return
    }
    const command = state.draft.command.trim()
    if (state.draft.label.trim() === '' || command === '') {
      setProblem(state.draft.label.trim() === '' ? 'label' : 'command')
      return
    }
    if (isCommandTaken(list, target, command)) {
      setProblem('commandTaken')
      return
    }
    const drafts =
      target === 'new'
        ? withNewActionFirst(list, state.draft)
        : list.map((one, at) => (at === target ? state.draft : one))
    if (saveList(drafts, target === 'new' ? 0 : target)) {
      setForm(null)
    }
  }
  const formFor = (target: Target): React.JSX.Element | null =>
    form?.target === target ? (
      <GameActionForm
        state={form.state}
        problem={problem}
        onChange={(state) => setForm({ target, state })}
        onSave={save}
        onCancel={() => setForm(null)}
        onRemove={
          typeof target === 'number'
            ? () => {
                saveList(
                  list.filter((_, at) => at !== target),
                  0
                )
                setForm(null)
              }
            : null
        }
      />
    ) : null
  const full = list.length >= GAME_ACTIONS_MAX
  const templates = gameActionTemplates().filter(
    (one) => !list.some((action) => action.command === one.command)
  )
  const setupLabel = translate('settings.gameActions.setup', 'Create with setup')

  return (
    <div
      id={getRepositoryGameActionsSectionId(repoId)}
      data-slot="game-actions-settings"
      className="pt-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 border-t border-border pb-2.5 pt-4">
        <div className="min-w-0 flex-[1_1_240px]">
          <b className="block text-sm font-medium">
            {translate('settings.gameActions.title', 'Actions')}
          </b>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {translate(
              'settings.gameActions.description',
              "Orca's own show up on their own when they apply; yours go in the row or in ⋯. /orca-game:setup writes them to orca.yaml; what you change here stays on this machine."
            )}
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            className="h-7"
            disabled={!sendToLead}
            title={
              sendToLead
                ? undefined
                : translate('settings.gameActions.setupNoLead', 'Start the lead first')
            }
            onClick={() => void sendToLead?.('setup', '/orca-game:setup', setupLabel)}
          >
            {setupLabel}
          </Button>
          <Button
            size="sm"
            className="h-7"
            disabled={full}
            onClick={() => open('new', EMPTY_ACTION_DRAFT)}
          >
            {translate('settings.gameActions.new', 'New action')}
          </Button>
        </div>
      </div>
      {formFor('new')}
      {!full && templates.length > 0 && form?.target !== 'new' ? (
        <div className="flex flex-wrap items-center gap-1 pb-0.5 pt-2.5 text-xs text-muted-foreground">
          <span className="mr-1">{translate('settings.gameActions.startWith', 'Start with')}</span>
          {templates.map((one) => (
            <button
              key={one.command}
              type="button"
              className="inline-flex h-[22px] items-center gap-1.5 rounded-[5px] bg-muted px-[7px] text-xs text-foreground hover:bg-accent"
              onClick={() => open('new', { ...EMPTY_ACTION_DRAFT, ...one })}
            >
              <TeamActionIcon icon={one.icon} />
              <span>{one.label}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className={HEAD}>
        {translate('settings.gameActions.projectHead', 'This project · {{count}} of {{max}}', {
          count: list.length,
          max: GAME_ACTIONS_MAX
        })}
      </div>
      {list.map((draft, at) => (
        <div key={`${draft.command}-${draft.label}-${at}`}>
          <ProjectActionRow
            draft={draft}
            first={at === 0}
            source={source}
            onUp={() => saveList(movedUp(list, at), at)}
            onEdit={() => open(at, draft)}
            onPin={() => {
              const next = withPinToggled(list, at)
              setPinFull(next === 'full')
              if (next !== 'full') {
                saveList(next, at)
              }
            }}
          />
          {formFor(at)}
        </div>
      ))}
      {pinFull ? (
        <p className="mt-1.5 text-xs text-destructive">
          {translate(
            'settings.gameActions.pinFull',
            'The row holds 3 of your actions. Turn another off first.'
          )}
        </p>
      ) : null}
      {local !== undefined ? (
        <button
          type="button"
          className="mt-2 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          onClick={() =>
            updateSettings({
              orchestratorGameProjects: withOrchestratorGameProjectActions(
                settings.orchestratorGameProjects,
                repoId,
                undefined
              )
            })
          }
        >
          {translate('settings.gameActions.inherit', "Use orca.yaml's list again")}
        </button>
      ) : null}
      <div className={HEAD}>{translate('settings.gameActions.orcaHead', 'From Orca')}</div>
      {orcaRows.map((row) => (
        <div key={row.id}>
          <OrcaActionSettingsRow
            row={row}
            onEdit={() =>
              open(
                row.id,
                {
                  ...EMPTY_ACTION_DRAFT,
                  label: row.label,
                  command: row.id,
                  icon: row.icon,
                  prompt: row.prompt
                },
                true
              )
            }
            onToggle={() =>
              updateSettings({
                orchestratorGameProjects: withOrchestratorGameProjectOrcaActions(
                  settings.orchestratorGameProjects,
                  repoId,
                  withOrcaEnabled(localOrca, projectLayer?.orcaActions, row.id, !row.enabled)
                )
              })
            }
          />
          {formFor(row.id)}
        </div>
      ))}
    </div>
  )
}

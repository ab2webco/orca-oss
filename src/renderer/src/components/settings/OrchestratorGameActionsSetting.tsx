import { useState } from 'react'
import { toast } from 'sonner'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  GAME_ACTIONS_MAX,
  GAME_ACTION_PINS_MAX,
  type OrchestratorGameAction
} from '../../../../shared/orchestrator-game-actions'
import type { OrchestratorGameLayer } from '../../../../shared/orchestrator-game-config'
import {
  parseGameOrcaActions,
  type GameOrcaActionId
} from '../../../../shared/orchestrator-game-orca-actions'
import {
  withOrchestratorGameProjectMachineActions,
  withOrchestratorGameProjectOrcaActions
} from '../../../../shared/orchestrator-game-settings-updates'
import { captureDirectSshMutationExpectation } from '@/lib/ssh-mutation-expectation'
import { useAppStore } from '../../store'
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
  GAME_ACTION_PICKER_ICONS,
  isCommandTaken,
  orcaActionRowsOf,
  withOrcaEnabled,
  withOrcaWords,
  withPinToggled
} from './orchestrator-game-action-list'
import {
  scopedListsOf,
  scopedRowsOf,
  withMovedUp,
  withRemovedAction,
  withSavedAction,
  type ActionScope,
  type ScopedLists
} from './orchestrator-game-action-scopes'
import {
  orcaYamlWriteErrorText,
  useOrcaYamlGameActions,
  writeOrcaYamlGameActions
} from './orca-yaml-game-actions-file'
import { gameActionTemplates } from './orchestrator-game-action-templates'
import { takeNewGameActionRequest } from './game-actions-settings-intent'
import { getRepositoryGameActionsSectionId } from './repository-settings-targets'
import { translate } from '@/i18n/i18n'

type GameSettings = Pick<GlobalSettings, 'orchestratorGameProjects'>
// Why: V30 starts a new action on the picker's first icon, upload, already chosen.
const NEW_ACTION_DRAFT: ActionDraft = { ...EMPTY_ACTION_DRAFT, icon: GAME_ACTION_PICKER_ICONS[0] }
type Target = number | 'new' | GameOrcaActionId
type Form = { target: Target; state: GameActionFormState }
const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

const HEAD = 'mb-0.5 mt-4 text-xs font-medium text-muted-foreground/70'

/** Prototype V30's Settings > Actions: each project button saved in orca.yaml or on this machine,
 *  as its form says, and Orca's buttons on this machine. */
export function ProjectOrchestratorGameActionsSetting({
  repoId,
  rootPath,
  connectionId,
  isReachable,
  settings,
  projectLayer,
  updateSettings
}: {
  repoId: string
  /** The worktree whose orca.yaml the running game reads, so a save here is what it uses. */
  rootPath: string
  connectionId: string | undefined
  isReachable: boolean
  settings: GameSettings
  projectLayer: OrchestratorGameLayer | undefined
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element {
  const localLayer = settings.orchestratorGameProjects?.[repoId]
  const yaml = useOrcaYamlGameActions({ rootPath, connectionId, isReachable })
  const lists = scopedListsOf(yaml.file?.actions ?? projectLayer?.actions ?? [], localLayer)
  const rows = scopedRowsOf(lists)
  const list = rows.map((row) => actionDraftOf(row.action))
  const machineLabel = translate('settings.gameActions.machine', 'This machine')
  const localOrca = parseGameOrcaActions(localLayer?.orcaActions).value
  const orcaRows = orcaActionRowsOf(projectLayer?.orcaActions, localOrca)
  // Why a lazy initial state: the dock's request is read once, on the first render.
  const [form, setForm] = useState<Form | null>(() =>
    takeNewGameActionRequest(repoId)
      ? {
          target: 'new',
          state: {
            draft: NEW_ACTION_DRAFT,
            isNew: true,
            orca: false,
            commandTouched: false,
            scope: 'project'
          }
        }
      : null
  )
  const [problem, setProblem] = useState<ActionDraftProblem | null>(null)
  const [pinFull, setPinFull] = useState(false)
  const sendToLead = useTeamLeadPrompt()

  // Why orca.yaml first: when its write is refused, this machine's settings stay as they were.
  const persist = async (next: ScopedLists): Promise<boolean> => {
    if (!sameJson(next.project, lists.project)) {
      try {
        if (!yaml.file) {
          throw new Error('unread')
        }
        const expectation = connectionId
          ? captureDirectSshMutationExpectation(useAppStore.getState(), connectionId)
          : undefined
        yaml.setFile(
          await writeOrcaYamlGameActions({
            fs: window.api.fs,
            rootPath,
            connectionId,
            expectation,
            shown: yaml.file.text,
            actions: next.project
          })
        )
      } catch (error) {
        toast.error(orcaYamlWriteErrorText(error))
        return false
      }
    }
    if (!sameJson(next.machine, lists.machine) || localLayer?.actions !== undefined) {
      updateSettings({
        orchestratorGameProjects: withOrchestratorGameProjectMachineActions(
          settings.orchestratorGameProjects,
          repoId,
          next.machine
        )
      })
    }
    return true
  }
  const open = (target: Target, draft: ActionDraft, scope: ActionScope, orca = false): void => {
    setProblem(null)
    const isNew = target === 'new'
    setForm({
      target,
      state: { draft, isNew, orca, commandTouched: !isNew || draft.command !== '', scope }
    })
  }
  const save = async (): Promise<void> => {
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
    const pinned = list.filter((one) => one.pin).length < GAME_ACTION_PINS_MAX
    const draft = target === 'new' ? { ...state.draft, pin: pinned } : state.draft
    const { actions, problems } = actionsOfDrafts([draft])
    if (!actions?.[0]) {
      setProblem(problems[0] ?? null)
      return
    }
    const from = target === 'new' ? null : (rows[target]?.action ?? null)
    if (await persist(withSavedAction(lists, actions[0], state.scope, from))) {
      setForm(null)
    }
  }
  const remove = async (action: OrchestratorGameAction, scope: ActionScope): Promise<void> => {
    if (await persist(withRemovedAction(lists, action, scope))) {
      setForm(null)
    }
  }
  const formFor = (target: Target): React.JSX.Element | null =>
    form?.target === target ? (
      <GameActionForm
        state={form.state}
        problem={problem}
        onChange={(state) => setForm({ target, state })}
        onSave={() => void save()}
        onCancel={() => setForm(null)}
        onRemove={
          typeof target === 'number' && rows[target]
            ? () => void remove(rows[target]!.action, form.state.scope)
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
              "Saved in orca.yaml, or only on this machine if you choose, and /orca-game:setup writes it. Orca's own show up on their own when they apply; yours go in the row or in ⋯."
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
            onClick={() => open('new', NEW_ACTION_DRAFT, 'project')}
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
              onClick={() => open('new', { ...EMPTY_ACTION_DRAFT, ...one }, 'project')}
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
      {list.map((draft, at) => {
        const row = rows[at]!
        const moved = withMovedUp(lists, at)
        // Why by identity: the pin is saved in the list the row is stored in, where it stands.
        const flipped = { ...row.action, pin: !draft.pin }
        return (
          <div key={`${draft.command}-${draft.label}-${at}`}>
            <ProjectActionRow
              draft={draft}
              first={moved === null}
              source={row.scope === 'project' ? 'orca.yaml' : machineLabel}
              onUp={() => moved && void persist(moved)}
              onEdit={() => open(at, draft, row.scope)}
              onPin={() => {
                const full = withPinToggled(list, at) === 'full'
                setPinFull(full)
                if (!full) {
                  void persist(
                    row.scope === 'project'
                      ? {
                          ...lists,
                          project: lists.project.map((one) => (one === row.action ? flipped : one))
                        }
                      : withSavedAction(lists, flipped, 'machine', row.action)
                  )
                }
              }}
            />
            {formFor(at)}
          </div>
        )
      })}
      {pinFull ? (
        <p className="mt-1.5 text-xs text-destructive">
          {translate(
            'settings.gameActions.pinFull',
            'The row holds 3 of your actions. Turn another off first.'
          )}
        </p>
      ) : null}
      {lists.machine.length > 0 || localLayer?.actions !== undefined ? (
        <button
          type="button"
          className="mt-2 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          onClick={() =>
            updateSettings({
              orchestratorGameProjects: withOrchestratorGameProjectMachineActions(
                settings.orchestratorGameProjects,
                repoId,
                []
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
                'machine',
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

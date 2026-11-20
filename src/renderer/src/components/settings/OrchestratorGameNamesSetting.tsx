import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  ORCHESTRATOR_GAME_BUILT_IN_ROSTERS,
  type GameMemberName
} from '../../../../shared/orchestrator-game-member-names'
import {
  resolveOrchestratorGameLead,
  type OrchestratorGameLayer
} from '../../../../shared/orchestrator-game-config'
import { gameLeadSourceOf } from '../../../../shared/orchestrator-game-lead-source'
import type { OrchestratorGameLead } from '../../../../shared/orchestrator-game-lead'
import { withOrchestratorGameProjectLead } from '../../../../shared/orchestrator-game-settings-updates'
import { LeadTextRow, leadNameField } from './OrchestratorGameLeadSetting'
import { OrchestratorGameMemberNamesRow } from './OrchestratorGameMemberNamesRow'
import { SettingsSubsectionHeader } from './SettingsFormControls'
import { orchestratorGameSourceLabel } from './orchestrator-game-setting-labels'
import { translate } from '@/i18n/i18n'

type GameSettings = Pick<GlobalSettings, 'orchestratorGame' | 'orchestratorGameProjects'>

/** The scene in use and the definitions Settings could read, as the Team panel takes them. */
export type OrchestratorGameNamesScene = {
  id: string
  extensions: readonly { id: string; definition: { roster?: readonly GameMemberName[] } }[]
}

// Why null: a plugin's roster lives in its process, so Settings says "the scene's" instead of guessing.
const sceneRosterOf = (scene: OrchestratorGameNamesScene): readonly GameMemberName[] | null =>
  Object.hasOwn(ORCHESTRATOR_GAME_BUILT_IN_ROSTERS, scene.id)
    ? ORCHESTRATOR_GAME_BUILT_IN_ROSTERS[
        scene.id as keyof typeof ORCHESTRATOR_GAME_BUILT_IN_ROSTERS
      ]
    : (scene.extensions.find((one) => one.id === scene.id)?.definition.roster ?? null)

/** Where the team's names come from, and the lead's and members' names for this machine (ORCA-1304). */
export function ProjectOrchestratorGameNamesSetting({
  repoId,
  settings,
  projectLayer,
  scene,
  updateSettings
}: {
  repoId: string
  settings: GameSettings
  projectLayer: OrchestratorGameLayer | undefined
  scene: OrchestratorGameNamesScene
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element {
  const local = settings.orchestratorGameProjects?.[repoId]
  const stored = local?.orchestrator
  const layers = { global: settings.orchestratorGame, project: projectLayer, local }
  const lead = resolveOrchestratorGameLead(layers)
  const inherited = resolveOrchestratorGameLead({ ...layers, local: undefined })
  const set = <K extends 'label' | 'memberNames'>(
    key: K,
    value: OrchestratorGameLead[K] | undefined
  ): void =>
    updateSettings({
      orchestratorGameProjects: withOrchestratorGameProjectLead(
        settings.orchestratorGameProjects,
        repoId,
        key,
        value
      )
    })
  const field = leadNameField()
  const labelText = stored?.label ?? ''
  const namesSource = gameLeadSourceOf(layers, 'memberNames')

  return (
    <div data-slot="game-names-settings" className="space-y-1 pt-3">
      <SettingsSubsectionHeader
        title={translate('settings.gameNames.title', 'Names')}
        description={translate(
          'settings.gameNames.description',
          "Each member takes the next free name from the scene's roster. The lead is called Lead until you name it. /orca-game:setup asks for both."
        )}
      />
      <LeadTextRow
        key={`label:${labelText}`}
        field={field}
        stored={labelText}
        description={`${lead.label ?? translate('settings.gameNames.unnamedLead', 'Lead, until you name it')} · ${orchestratorGameSourceLabel(gameLeadSourceOf(layers, 'label'))}`}
        placeholder={inherited.label ?? translate('settings.gameNames.leadPlaceholder', 'Lead')}
        onCommit={(next) => set('label', typeof next === 'string' ? next : undefined)}
      />
      <OrchestratorGameMemberNamesRow
        key={`memberNames:${JSON.stringify(stored?.memberNames ?? null)}`}
        stored={stored?.memberNames}
        inherited={inherited.memberNames ?? sceneRosterOf(scene) ?? undefined}
        sourceLabel={
          namesSource === 'default'
            ? translate('settings.gameNames.fromScene', 'from the scene')
            : orchestratorGameSourceLabel(namesSource)
        }
        onCommit={(next) => set('memberNames', next)}
      />
    </div>
  )
}

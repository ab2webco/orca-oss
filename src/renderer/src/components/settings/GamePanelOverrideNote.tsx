import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { hostDisplayLabel } from '@/lib/local-host-display-label'
import { getRepoExecutionHostId } from '../../../../shared/execution-host'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { GamePanelField, GamePanelValue } from '../../../../shared/orchestrator-game-panel'
import { useTeamPanelSettingLayers } from '../team-panel/team-panel-setting-layers'
import {
  gamePanelOverridesOf,
  withoutGamePanelProjectField,
  type GamePanelOverride,
  type GamePanelProjectLayers
} from './game-panel-overrides'
import { getRepositoryGameSectionId } from './repository-settings-targets'

type GameSettings = Pick<GlobalSettings, 'orchestratorGame' | 'orchestratorGameProjects'>

export type GamePanelOverrideProject = GamePanelProjectLayers & { name: string }

/** Every known project with a layer on this machine, plus the active one's orca.yaml. */
export function useGamePanelOverrideProjects(settings: GameSettings): GamePanelOverrideProject[] {
  const repos = useAppStore((s) => s.repos)
  const activeRepoId = useAppStore((s) =>
    s.activeWorktreeId ? (s.getKnownWorktreeById(s.activeWorktreeId)?.repoId ?? null) : null
  )
  // Why only the active project's orca.yaml: reading every project's file is a host call each.
  const { project: activeYaml } = useTeamPanelSettingLayers()
  const locals = settings.orchestratorGameProjects
  return useMemo(
    () =>
      repos.flatMap((repo) => {
        const local = locals?.[repo.id]
        const project = repo.id === activeRepoId ? activeYaml : undefined
        // Why the host: one repo opened on several hosts lists the same name once per host.
        const shared = repos.some(
          (one) => one.id !== repo.id && one.displayName === repo.displayName
        )
        const name = shared
          ? `${repo.displayName} · ${hostDisplayLabel(getRepoExecutionHostId(repo))}`
          : repo.displayName
        return local || project ? [{ repoId: repo.id, name, project, local }] : []
      }),
    [activeRepoId, activeYaml, locals, repos]
  )
}

const lineOf = (override: GamePanelOverride, name: string, value: string): string =>
  ({
    local: translate(
      'auto.components.settings.GamePanelOverrideNote.local',
      '{{project}} uses {{value}} on this machine.',
      { project: name, value }
    ),
    project: translate(
      'auto.components.settings.GamePanelOverrideNote.project',
      "{{project}}'s orca.yaml sets {{value}}.",
      { project: name, value }
    ),
    view: translate(
      'auto.components.settings.GamePanelOverrideNote.view',
      '{{project}} shows {{value}}, from its Default view.',
      { project: name, value }
    )
  })[override.source]

/** Under a global panel row: which projects show another value, and how to follow this one. */
export function GamePanelOverrideNote({
  field,
  settings,
  projects,
  nameOf,
  updateSettings
}: {
  field: GamePanelField
  settings: GameSettings
  projects: readonly GamePanelOverrideProject[]
  nameOf: (value: GamePanelValue) => string
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element | null {
  const overrides = gamePanelOverridesOf(field, settings.orchestratorGame, projects)
  if (overrides.length === 0) {
    return null
  }
  const names = new Map(projects.map((one) => [one.repoId, one.name]))
  const open = (repoId: string): void =>
    useAppStore.getState().openSettingsTarget({
      pane: 'repo',
      repoId,
      sectionId: getRepositoryGameSectionId(repoId)
    })
  return (
    <span data-slot="game-panel-override" data-field={field} className="mt-1 block space-y-0.5">
      {overrides.map((override) => (
        <span
          key={override.repoId}
          className="flex flex-wrap items-center gap-x-2 text-status-warning"
        >
          <span>
            {lineOf(
              override,
              names.get(override.repoId) ?? override.repoId,
              nameOf(override.value)
            )}
          </span>
          <Button
            type="button"
            variant="link"
            size="xs"
            className="h-auto px-0"
            onClick={() => open(override.repoId)}
          >
            {translate('auto.components.settings.GamePanelOverrideNote.open', 'Open project')}
          </Button>
          {override.source === 'local' ? (
            <Button
              type="button"
              variant="link"
              size="xs"
              className="h-auto px-0"
              onClick={() =>
                updateSettings({
                  orchestratorGameProjects: withoutGamePanelProjectField(
                    settings.orchestratorGameProjects,
                    override.repoId,
                    field
                  )
                })
              }
            >
              {translate('auto.components.settings.GamePanelOverrideNote.useGlobal', 'Use global')}
            </Button>
          ) : null}
        </span>
      ))}
    </span>
  )
}

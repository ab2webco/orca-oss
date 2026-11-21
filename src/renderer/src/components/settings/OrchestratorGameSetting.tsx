import { useState } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { Repo } from '../../../../shared/repo-types'
import {
  ORCHESTRATOR_GAME_BUILT_IN_SCENES,
  resolveOrchestratorGameConfig,
  type OrchestratorGameBuiltInScene,
  type OrchestratorGameLayer
} from '../../../../shared/orchestrator-game-config'
import {
  withOrchestratorGameProjectField,
  withOrchestratorGameProjectScene
} from '../../../../shared/orchestrator-game-settings-updates'
import { useAppStore } from '../../store'
import { SearchableSetting } from './SearchableSetting'
import {
  CUSTOM_SCENE_FILE,
  INHERIT_SCENE,
  OrchestratorGameSceneSelect
} from './OrchestratorGameSceneSelect'
import {
  OrchestratorGameSceneFileField,
  OrchestratorGameSceneFileStatus
} from './OrchestratorGameSceneFileField'
import { repositoryTargetWorktreeOf } from './repository-target-worktree'
import {
  useOrchestratorGameProjectSceneFiles,
  useOrchestratorGameSceneFile
} from './use-orchestrator-game-scene-file'
import {
  orchestratorGameSceneFileId,
  orchestratorGameSceneFileOfId
} from '../../../../shared/orchestrator-game-scene-file'
import { SettingsRow, SettingsSubsectionHeader } from './SettingsFormControls'
import { translate } from '@/i18n/i18n'
import {
  orchestratorGameInheritLabel,
  orchestratorGameSourceLabel as sourceLabel
} from './orchestrator-game-setting-labels'
import { ProjectOrchestratorGameLeadSetting } from './OrchestratorGameLeadSetting'
import { ProjectOrchestratorGameNamesSetting } from './OrchestratorGameNamesSetting'
import { ProjectOrchestratorGameActionsSetting } from './OrchestratorGameActionsSetting'
import { OrchestratorGameTimezoneRow } from './OrchestratorGameRenderSetting'
import { OrchestratorGameScenesSkillCard } from './OrchestratorGameScenesSkillCard'
import { ProjectGamePanelRows } from './OrchestratorGamePanelSetting'
import { getAgentTeamsGameSearchEntry } from './orchestrator-game-panel-search'
import { useAdvisorPluginPresence } from './use-advisor-plugin-presence'
import { getRepositoryGameSectionId } from './repository-settings-targets'
import { gameRowFactsOf, shownGameRows } from './orchestrator-game-row-visibility'
import { GlobalTerminalGroups, ProjectTerminalGroups } from './OrchestratorGameTerminalRows'
import { TerminalPanesHeading } from './OrchestratorGameTerminalBand'

type GameSettings = Pick<GlobalSettings, 'orchestratorGame' | 'orchestratorGameProjects'>
const title = (): string =>
  translate('auto.components.settings.OrchestratorGameSetting.title', 'Agent Teams game')

const sectionHeader = (): React.JSX.Element => (
  <SettingsSubsectionHeader
    title={title()}
    description={translate(
      'auto.components.settings.OrchestratorGameSetting.scope',
      'Applies only to Claude Agent Teams panes. Plain Claude, Codex and other agents never load it.'
    )}
  />
)

const sceneTitle = (): string =>
  translate('auto.components.settings.OrchestratorGameSetting.scene', 'Scene')

export function OrchestratorGameSetting({
  settings,
  updateSettings
}: {
  settings: GameSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element {
  const facts = gameRowFactsOf({ page: 'global', layers: { global: settings.orchestratorGame } })
  const shown = shownGameRows(facts)
  const { description, keywords } = getAgentTeamsGameSearchEntry(facts)
  return (
    <section>
      <SearchableSetting
        title={title()}
        description={description}
        keywords={keywords}
        className="space-y-1"
      >
        {sectionHeader()}
        <GlobalTerminalGroups settings={settings} shown={shown} updateSettings={updateSettings} />
      </SearchableSetting>
      {shown.has('scene') ? <OrchestratorGameScenesSkillCard /> : null}
    </section>
  )
}

const EMPTY_WORKTREES: never[] = []

const builtInOf = (scene: string): OrchestratorGameBuiltInScene =>
  ORCHESTRATOR_GAME_BUILT_IN_SCENES.find((one) => one === scene) ?? 'quest'

export function ProjectOrchestratorGameSetting({
  repo,
  settings,
  projectLayer,
  updateSettings
}: {
  repo: Pick<Repo, 'id' | 'path' | 'connectionId' | 'executionHostId'>
  settings: GameSettings
  projectLayer: OrchestratorGameLayer | undefined
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element {
  const repoId = repo.id
  const advisorPlugin = useAdvisorPluginPresence(repo)
  const local = settings.orchestratorGameProjects?.[repoId]
  const layers = { global: settings.orchestratorGame, project: projectLayer, local }
  const { config, sources, sceneFile } = resolveOrchestratorGameConfig(layers)
  const facts = gameRowFactsOf({ page: 'project', layers, advisorPlugin })
  const shown = shownGameRows(facts)
  const connectionId = repo.connectionId ?? undefined
  const activeWorktreeId = useAppStore((state) => state.activeWorktreeId)
  const worktrees = useAppStore((state) => state.worktreesByRepo[repoId] ?? EMPTY_WORKTREES)
  const sshStatus = useAppStore((state) =>
    connectionId ? state.sshConnectionStates.get(connectionId)?.status : undefined
  )
  const target = repositoryTargetWorktreeOf(activeWorktreeId, repo, worktrees)
  const isReachable = !connectionId || sshStatus === 'connected'
  const file = useOrchestratorGameSceneFile({
    rootPath: target.path,
    connectionId,
    isReachable,
    path: sceneFile
  })
  // Why the file's definition: the panel draws a custom scene's own cast, as the band does.
  const panelScene = {
    id: config.scene,
    extensions:
      sceneFile !== null && file.state?.status === 'ok'
        ? [{ id: config.scene, pluginId: 'file', definition: file.state.definition }]
        : []
  }
  const projectFiles = useOrchestratorGameProjectSceneFiles({
    rootPath: target.path,
    connectionId,
    isReachable
  })
  const [isCustomPicked, setIsCustomPicked] = useState(false)
  const isCustom = local?.sceneFile !== undefined || isCustomPicked
  // Why: a file from the scenes folder shows as itself in the picker, not as "Custom file…".
  const listedFile =
    !isCustomPicked && local?.sceneFile !== undefined && projectFiles.includes(local.sceneFile)
      ? orchestratorGameSceneFileId(local.sceneFile)
      : null
  const setScene = (choice: { scene: string } | { sceneFile: string } | null): void => {
    setIsCustomPicked(false)
    updateSettings({
      orchestratorGameProjects: withOrchestratorGameProjectScene(
        settings.orchestratorGameProjects,
        repoId,
        choice
      )
    })
  }
  const effective = (key: 'scene' | 'timezone', text: string): string =>
    `${text} · ${sourceLabel(sources[key])}`
  const description = translate(
    'auto.components.settings.OrchestratorGameSetting.projectDescription',
    "Override the game for this project on this machine. The project's orca.yaml sets its default."
  )
  const sceneRows = (): React.JSX.Element => (
    <>
      <SettingsRow
        label={sceneTitle()}
        description={effective('scene', sceneFile ?? config.scene)}
        control={
          <OrchestratorGameSceneSelect
            value={listedFile ?? (isCustom ? CUSTOM_SCENE_FILE : (local?.scene ?? INHERIT_SCENE))}
            ariaLabel={sceneTitle()}
            inheritLabel={orchestratorGameInheritLabel()}
            projectFiles={projectFiles}
            onChange={(scene) => {
              const path = scene === null ? null : orchestratorGameSceneFileOfId(scene)
              setScene(scene === null ? null : path === null ? { scene } : { sceneFile: path })
            }}
            onCustomFile={() => setIsCustomPicked(true)}
          />
        }
      />
      {isCustom ? (
        <OrchestratorGameSceneFileField
          key={local?.sceneFile ?? ''}
          path={local?.sceneFile}
          rootPath={target.path}
          worktreeId={target.id}
          connectionId={connectionId}
          baseScene={builtInOf(config.scene)}
          read={local?.sceneFile === undefined ? null : file.state}
          onPath={(path) => setScene({ sceneFile: path })}
          onFileWritten={file.reload}
        />
      ) : (
        <OrchestratorGameSceneFileStatus read={file.state} />
      )}
    </>
  )
  const stored = local?.timezone ?? ''
  const timezoneRow = (): React.JSX.Element => (
    <OrchestratorGameTimezoneRow
      key={stored}
      stored={stored}
      effective={effective('timezone', config.timezone)}
      onCommit={(value) =>
        updateSettings({
          orchestratorGameProjects: withOrchestratorGameProjectField(
            settings.orchestratorGameProjects,
            repoId,
            'timezone',
            value
          )
        })
      }
    />
  )

  return (
    <SearchableSetting
      id={getRepositoryGameSectionId(repoId)}
      title={title()}
      description={description}
      keywords={getAgentTeamsGameSearchEntry(facts).keywords}
    >
      <div className="space-y-1">
        {sectionHeader()}
        <p className="text-xs text-muted-foreground">{description}</p>
        <ProjectGamePanelRows
          repoId={repoId}
          scene={panelScene}
          settings={settings}
          projectLayer={projectLayer}
          advisorPlugin={advisorPlugin}
          drawers={{ scene: sceneRows, timezone: timezoneRow }}
          updateSettings={updateSettings}
        />
        <ProjectOrchestratorGameActionsSetting
          key={repoId}
          repoId={repoId}
          rootPath={target.path}
          connectionId={connectionId}
          isReachable={isReachable}
          settings={settings}
          projectLayer={projectLayer}
          updateSettings={updateSettings}
        />
        <ProjectOrchestratorGameNamesSetting
          repoId={repoId}
          settings={settings}
          projectLayer={projectLayer}
          scene={panelScene}
          updateSettings={updateSettings}
        />
        <ProjectOrchestratorGameLeadSetting
          repoId={repoId}
          settings={settings}
          projectLayer={projectLayer}
          updateSettings={updateSettings}
        />
        <ProjectTerminalGroups
          repoId={repoId}
          settings={settings}
          projectLayer={projectLayer}
          shown={shown}
          fileScene={file.state}
          terminalHeading={<TerminalPanesHeading />}
          updateSettings={updateSettings}
        />
      </div>
    </SearchableSetting>
  )
}

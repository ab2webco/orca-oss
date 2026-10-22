import { useState } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { Repo } from '../../../../shared/repo-types'
import {
  DEFAULT_ORCHESTRATOR_GAME_CONFIG,
  ORCHESTRATOR_GAME_BUILT_IN_SCENES,
  resolveOrchestratorGameConfig,
  type OrchestratorGameBuiltInScene,
  type OrchestratorGameConfig,
  type OrchestratorGameLayer
} from '../../../../shared/orchestrator-game-config'
import {
  withOrchestratorGameField,
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
import { OrchestratorGameScenePreview } from './OrchestratorGameScenePreview'
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
import {
  SettingsRow,
  SettingsSegmentedControl,
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from './SettingsFormControls'
import { translate } from '@/i18n/i18n'
import {
  orchestratorGameInheritLabel,
  orchestratorGameModeLabels as modeLabels,
  orchestratorGameSourceLabel as sourceLabel
} from './orchestrator-game-setting-labels'
import { ProjectOrchestratorGameLeadSetting } from './OrchestratorGameLeadSetting'
import { ProjectOrchestratorGameActionsSetting } from './OrchestratorGameActionsSetting'
import {
  OrchestratorGameOpenLinksRow,
  orchestratorGameOpenLinksLabels
} from './OrchestratorGameOpenLinksSetting'
import {
  OrchestratorGameLookRows,
  orchestratorGameRenderLabels
} from './OrchestratorGameRenderSetting'
import { OrchestratorGameScenesSkillCard } from './OrchestratorGameScenesSkillCard'
import {
  OrchestratorGameViewRows,
  ProjectOrchestratorGameViewRows
} from './OrchestratorGameViewSetting'
import { shownOrchestratorGameModeOf } from '../../../../shared/orchestrator-game-view'

type GameSettings = Pick<GlobalSettings, 'orchestratorGame' | 'orchestratorGameProjects'>
type ToggleKey = 'hud' | 'rewards' | 'tracker'

const toggles = (): { key: ToggleKey; label: string; description: string }[] => [
  {
    key: 'hud',
    label: translate('auto.components.settings.OrchestratorGameSetting.hud', 'Teammate HUD'),
    description: translate(
      'auto.components.settings.OrchestratorGameSetting.hudDescription',
      "Show the fleet band above Claude's prompt."
    )
  },
  {
    key: 'rewards',
    label: translate('auto.components.settings.OrchestratorGameSetting.rewards', 'Rewards'),
    description: translate(
      'auto.components.settings.OrchestratorGameSetting.rewardsDescription',
      'XP, level-ups and celebrations when reviews merge or CI turns green.'
    )
  },
  {
    key: 'tracker',
    label: translate(
      'auto.components.settings.OrchestratorGameSetting.tracker',
      'Work item tracking'
    ),
    description: translate(
      'auto.components.settings.OrchestratorGameSetting.trackerDescription',
      'Follow the linked Plane, Jira, Linear, GitHub or GitLab item in the flow.'
    )
  }
]

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

const keywords = ['agent teams', 'game', 'quest', 'orchestrator', 'hud', 'rewards', 'zen', 'scene']

const sceneTitle = (): string =>
  translate('auto.components.settings.OrchestratorGameSetting.scene', 'Scene')

export function OrchestratorGameSetting({
  settings,
  updateSettings
}: {
  settings: GameSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element {
  const layer = settings.orchestratorGame
  const resolved = resolveOrchestratorGameConfig({ global: layer }).config
  // Why the shown mode: with Show the game off the rest of the section is disabled and the preview is off.
  const config = { ...resolved, mode: shownOrchestratorGameModeOf(resolved) }
  const set = <K extends keyof OrchestratorGameConfig>(
    key: K,
    value: OrchestratorGameConfig[K]
  ): void => updateSettings({ orchestratorGame: withOrchestratorGameField(layer, key, value) })
  const description = translate(
    'auto.components.settings.OrchestratorGameSetting.description',
    'Pixel-art scenes, a teammate HUD and rewards inside Claude Agent Teams. Each project can change this in its orca.yaml.'
  )

  return (
    <section>
      <SearchableSetting
        title={title()}
        description={description}
        keywords={keywords}
        className="space-y-1"
      >
        {sectionHeader()}
        <OrchestratorGameViewRows settings={settings} updateSettings={updateSettings} />
        <SettingsRow
          label={sceneTitle()}
          description={translate(
            'auto.components.settings.OrchestratorGameSetting.sceneDescription',
            'The art the game draws. Installed plugins can add scenes.'
          )}
          control={
            <OrchestratorGameSceneSelect
              value={config.scene}
              ariaLabel={sceneTitle()}
              disabled={config.mode === 'off'}
              onChange={(scene) => set('scene', scene ?? DEFAULT_ORCHESTRATOR_GAME_CONFIG.scene)}
            />
          }
        />
        <OrchestratorGameScenePreview config={config} />
        {toggles().map((toggle) => (
          <SettingsSwitchRow
            key={toggle.key}
            label={toggle.label}
            description={toggle.description}
            checked={config[toggle.key]}
            disabled={config.mode === 'off'}
            onChange={() => set(toggle.key, !config[toggle.key])}
          />
        ))}
        <OrchestratorGameOpenLinksRow
          value={config.openLinks}
          disabled={config.mode === 'off'}
          onChange={(next) => set('openLinks', next)}
        />
        <OrchestratorGameLookRows
          layer={layer}
          disabled={config.mode === 'off'}
          onChange={(key, value) =>
            updateSettings({ orchestratorGame: withOrchestratorGameField(layer, key, value) })
          }
        />
      </SearchableSetting>
      <OrchestratorGameScenesSkillCard />
    </section>
  )
}

type FieldValue = 'true' | 'false'

const EMPTY_WORKTREES: never[] = []

const builtInOf = (scene: string): OrchestratorGameBuiltInScene =>
  ORCHESTRATOR_GAME_BUILT_IN_SCENES.find((one) => one === scene) ?? 'quest'

export function ProjectOrchestratorGameSetting({
  repo,
  settings,
  projectLayer,
  updateSettings
}: {
  repo: Pick<Repo, 'id' | 'path' | 'connectionId'>
  settings: GameSettings
  projectLayer: OrchestratorGameLayer | undefined
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element {
  const repoId = repo.id
  const local = settings.orchestratorGameProjects?.[repoId]
  const { config, sources, sceneFile } = resolveOrchestratorGameConfig({
    global: settings.orchestratorGame,
    project: projectLayer,
    local
  })
  const connectionId = repo.connectionId ?? undefined
  const activeWorktreeId = useAppStore((state) => state.activeWorktreeId)
  const worktrees = useAppStore((state) => state.worktreesByRepo[repoId] ?? EMPTY_WORKTREES)
  const sshStatus = useAppStore((state) =>
    connectionId ? state.sshConnectionStates.get(connectionId)?.status : undefined
  )
  const target = repositoryTargetWorktreeOf(activeWorktreeId, repo, worktrees)
  const file = useOrchestratorGameSceneFile({
    rootPath: target.path,
    connectionId,
    isReachable: !connectionId || sshStatus === 'connected',
    path: sceneFile
  })
  const projectFiles = useOrchestratorGameProjectSceneFiles({
    rootPath: target.path,
    connectionId,
    isReachable: !connectionId || sshStatus === 'connected'
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
  const set = <K extends keyof OrchestratorGameConfig>(
    key: K,
    value: OrchestratorGameConfig[K] | undefined
  ): void =>
    updateSettings({
      orchestratorGameProjects: withOrchestratorGameProjectField(
        settings.orchestratorGameProjects,
        repoId,
        key,
        value
      )
    })
  const labels = modeLabels()
  const inherit = orchestratorGameInheritLabel()
  const onOff = (value: boolean): string => (value ? labels.on : labels.off)
  const effective = (key: keyof OrchestratorGameConfig, text: string): string =>
    `${text} · ${sourceLabel(sources[key])}`
  const description = translate(
    'auto.components.settings.OrchestratorGameSetting.projectDescription',
    "Override the game for this project on this machine. The project's orca.yaml sets its default."
  )
  const rows: {
    key: ToggleKey
    label: string
    text: string
    value: FieldValue | 'inherit'
    options: { value: FieldValue | 'inherit'; label: string }[]
  }[] = toggles().map((toggle) => ({
    key: toggle.key,
    label: toggle.label,
    text: onOff(config[toggle.key]),
    value:
      local?.[toggle.key] === undefined
        ? ('inherit' as const)
        : (String(local[toggle.key]) as 'true' | 'false'),
    options: [
      { value: 'inherit' as const, label: inherit },
      { value: 'true' as const, label: labels.on },
      { value: 'false' as const, label: labels.off }
    ]
  }))

  return (
    <SearchableSetting title={title()} description={description} keywords={keywords}>
      <div className="space-y-1">
        {sectionHeader()}
        <p className="text-xs text-muted-foreground">{description}</p>
        <ProjectOrchestratorGameViewRows
          repoId={repoId}
          settings={settings}
          projectLayer={projectLayer}
          updateSettings={updateSettings}
        />
        {rows.map((row) => (
          <SettingsRow
            key={row.key}
            label={row.label}
            description={effective(row.key, row.text)}
            control={
              <SettingsSegmentedControl
                value={row.value}
                ariaLabel={row.label}
                size="sm"
                options={row.options}
                onChange={(next) => {
                  if (next === 'inherit') {
                    set(row.key, undefined)
                  } else {
                    set(row.key, next === 'true')
                  }
                }}
              />
            }
          />
        ))}
        <OrchestratorGameOpenLinksRow
          value={local?.openLinks ?? 'inherit'}
          effective={effective('openLinks', orchestratorGameOpenLinksLabels()[config.openLinks])}
          onChange={(next) => set('openLinks', next === 'inherit' ? undefined : next)}
        />
        <OrchestratorGameLookRows
          layer={local}
          effective={{
            render: effective('render', orchestratorGameRenderLabels()[config.render]),
            timezone: effective('timezone', config.timezone)
          }}
          onChange={set}
        />
        <SettingsRow
          label={sceneTitle()}
          description={effective('scene', sceneFile ?? config.scene)}
          control={
            <OrchestratorGameSceneSelect
              value={listedFile ?? (isCustom ? CUSTOM_SCENE_FILE : (local?.scene ?? INHERIT_SCENE))}
              ariaLabel={sceneTitle()}
              inheritLabel={inherit}
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
        <OrchestratorGameScenePreview
          config={{ ...config, mode: shownOrchestratorGameModeOf(config) }}
          fileScene={file.state}
        />
        <ProjectOrchestratorGameLeadSetting
          repoId={repoId}
          settings={settings}
          projectLayer={projectLayer}
          updateSettings={updateSettings}
        />
        <ProjectOrchestratorGameActionsSetting
          key={repoId}
          repoId={repoId}
          settings={settings}
          projectLayer={projectLayer}
          updateSettings={updateSettings}
        />
      </div>
    </SearchableSetting>
  )
}

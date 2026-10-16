import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  DEFAULT_ORCHESTRATOR_GAME_CONFIG,
  resolveOrchestratorGameConfig,
  type OrchestratorGameConfig,
  type OrchestratorGameLayer,
  type OrchestratorGameMode,
  type OrchestratorGameSource
} from '../../../../shared/orchestrator-game-config'
import {
  withOrchestratorGameField,
  withOrchestratorGameProjectField
} from '../../../../shared/orchestrator-game-settings-updates'
import { SearchableSetting } from './SearchableSetting'
import { INHERIT_SCENE, OrchestratorGameSceneSelect } from './OrchestratorGameSceneSelect'
import { SettingsRow, SettingsSegmentedControl, SettingsSwitchRow } from './SettingsFormControls'
import { translate } from '@/i18n/i18n'

type GameSettings = Pick<GlobalSettings, 'orchestratorGame' | 'orchestratorGameProjects'>
type ToggleKey = 'hud' | 'rewards' | 'tracker'

const modeLabels = (): Record<OrchestratorGameMode, string> => ({
  on: translate('auto.components.settings.OrchestratorGameSetting.on', 'On'),
  zen: translate('auto.components.settings.OrchestratorGameSetting.zen', 'Zen'),
  off: translate('auto.components.settings.OrchestratorGameSetting.off', 'Off')
})

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
  const { config } = resolveOrchestratorGameConfig({ global: layer })
  const set = <K extends keyof OrchestratorGameConfig>(
    key: K,
    value: OrchestratorGameConfig[K]
  ): void => updateSettings({ orchestratorGame: withOrchestratorGameField(layer, key, value) })
  const labels = modeLabels()
  const description = translate(
    'auto.components.settings.OrchestratorGameSetting.description',
    'Pixel-art scenes, a teammate HUD and rewards inside Claude Agent Teams. Each project can change this in its orca.yaml.'
  )

  return (
    <section className="space-y-1">
      <SearchableSetting title={title()} description={description} keywords={keywords}>
        <SettingsRow
          label={title()}
          description={description}
          control={
            <SettingsSegmentedControl
              value={config.mode}
              onChange={(mode) => set('mode', mode)}
              ariaLabel={translate(
                'auto.components.settings.OrchestratorGameSetting.mode',
                'Game mode'
              )}
              size="sm"
              options={(['on', 'zen', 'off'] as const).map((mode) => ({
                value: mode,
                label: labels[mode]
              }))}
            />
          }
        />
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
      </SearchableSetting>
    </section>
  )
}

const sourceLabel = (source: OrchestratorGameSource): string =>
  ({
    default: translate('auto.components.settings.OrchestratorGameSetting.sourceDefault', 'default'),
    global: translate(
      'auto.components.settings.OrchestratorGameSetting.sourceGlobal',
      'global setting'
    ),
    project: translate(
      'auto.components.settings.OrchestratorGameSetting.sourceProject',
      'from orca.yaml'
    ),
    local: translate('auto.components.settings.OrchestratorGameSetting.sourceLocal', 'this machine')
  })[source]

type FieldValue = OrchestratorGameMode | 'true' | 'false'

export function ProjectOrchestratorGameSetting({
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
  const local = settings.orchestratorGameProjects?.[repoId]
  const { config, sources } = resolveOrchestratorGameConfig({
    global: settings.orchestratorGame,
    project: projectLayer,
    local
  })
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
  const inherit = translate('auto.components.settings.OrchestratorGameSetting.inherit', 'Inherit')
  const onOff = (value: boolean): string => (value ? labels.on : labels.off)
  const effective = (key: keyof OrchestratorGameConfig, text: string): string =>
    `${text} · ${sourceLabel(sources[key])}`
  const description = translate(
    'auto.components.settings.OrchestratorGameSetting.projectDescription',
    "Override the game for this project on this machine. The project's orca.yaml sets its default."
  )
  const rows: {
    key: 'mode' | ToggleKey
    label: string
    text: string
    value: FieldValue | 'inherit'
    options: { value: FieldValue | 'inherit'; label: string }[]
  }[] = [
    {
      key: 'mode',
      label: translate('auto.components.settings.OrchestratorGameSetting.mode', 'Game mode'),
      text: labels[config.mode],
      value: local?.mode ?? 'inherit',
      options: [
        { value: 'inherit', label: inherit },
        ...(['on', 'zen', 'off'] as const).map((mode) => ({ value: mode, label: labels[mode] }))
      ]
    },
    ...toggles().map((toggle) => ({
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
  ]

  return (
    <SearchableSetting title={title()} description={description} keywords={keywords}>
      <div className="space-y-1">
        <div className="space-y-0.5 py-2">
          <h3 className="text-sm font-medium">{title()}</h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
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
                  } else if (row.key === 'mode') {
                    set('mode', next as OrchestratorGameMode)
                  } else {
                    set(row.key, next === 'true')
                  }
                }}
              />
            }
          />
        ))}
        <SettingsRow
          label={sceneTitle()}
          description={effective('scene', config.scene)}
          control={
            <OrchestratorGameSceneSelect
              value={local?.scene ?? INHERIT_SCENE}
              ariaLabel={sceneTitle()}
              inheritLabel={inherit}
              onChange={(scene) => set('scene', scene ?? undefined)}
            />
          }
        />
      </div>
    </SearchableSetting>
  )
}

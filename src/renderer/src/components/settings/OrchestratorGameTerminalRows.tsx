import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  resolveOrchestratorGameConfig,
  type OrchestratorGameConfig,
  type OrchestratorGameLayer
} from '../../../../shared/orchestrator-game-config'
import {
  withOrchestratorGameField,
  withOrchestratorGameProjectField
} from '../../../../shared/orchestrator-game-settings-updates'
import { shownOrchestratorGameModeOf } from '../../../../shared/orchestrator-game-view'
import type { SceneFileState } from './use-orchestrator-game-scene-file'
import { SettingsRow, SettingsSegmentedControl, SettingsSwitchRow } from './SettingsFormControls'
import {
  orchestratorGameInheritLabel,
  orchestratorGameModeLabels,
  orchestratorGameSourceLabel
} from './orchestrator-game-setting-labels'
import {
  OrchestratorGameOpenLinksRow,
  orchestratorGameOpenLinksLabels
} from './OrchestratorGameOpenLinksSetting'
import {
  OrchestratorGameRenderRow,
  orchestratorGameRenderLabels
} from './OrchestratorGameRenderSetting'
import { OrchestratorGameScenePreview } from './OrchestratorGameScenePreview'
import {
  OrchestratorGameDefaultViewRow,
  OrchestratorGameShowRow,
  ProjectOrchestratorGameViewRows
} from './OrchestratorGameViewSetting'
import { orchestratorGameSwitches, type ToggleKey } from './orchestrator-game-switches'
import { TerminalBandHeading, terminalBandTitle } from './OrchestratorGameTerminalBand'
import type { GameRowId } from './orchestrator-game-row-visibility'
import { GameRowGroupView, type GameRowDrawers } from './GameRowList'

type GameSettings = Pick<GlobalSettings, 'orchestratorGame' | 'orchestratorGameProjects'>
type Update = (updates: Partial<GlobalSettings>) => void

const switchOf = (key: ToggleKey) => orchestratorGameSwitches().find((one) => one.key === key)!

function Groups({
  shown,
  draw,
  terminalHeading
}: {
  shown: ReadonlySet<GameRowId>
  draw: GameRowDrawers
  terminalHeading?: React.ReactNode
}): React.JSX.Element {
  return (
    <>
      <GameRowGroupView group="terminal" shown={shown} draw={draw} heading={terminalHeading} />
      <GameRowGroupView
        group="band"
        shown={shown}
        draw={draw}
        heading={<TerminalBandHeading />}
        label={terminalBandTitle()}
        className="space-y-1 pt-4"
      />
    </>
  )
}

/** What every project's Agent Teams terminal panes launch with and draw. */
export function GlobalTerminalGroups({
  settings,
  shown,
  updateSettings
}: {
  settings: GameSettings
  shown: ReadonlySet<GameRowId>
  updateSettings: Update
}): React.JSX.Element {
  const layer = settings.orchestratorGame
  const config = resolveOrchestratorGameConfig({ global: layer }).config
  const set = <K extends keyof OrchestratorGameConfig>(
    key: K,
    value: OrchestratorGameConfig[K]
  ): void => updateSettings({ orchestratorGame: withOrchestratorGameField(layer, key, value) })
  const toggle = (key: ToggleKey) => () => {
    const one = switchOf(key)
    return (
      <SettingsSwitchRow
        label={one.label}
        description={one.description}
        checked={config[key]}
        onChange={() => set(key, !config[key])}
      />
    )
  }
  const draw: GameRowDrawers = {
    show: () => <OrchestratorGameShowRow settings={settings} updateSettings={updateSettings} />,
    view: () => (
      <OrchestratorGameDefaultViewRow settings={settings} updateSettings={updateSettings} />
    ),
    hud: toggle('hud'),
    rewards: toggle('rewards'),
    openLinks: () => (
      <OrchestratorGameOpenLinksRow
        value={config.openLinks}
        onChange={(next) => set('openLinks', next)}
      />
    ),
    tracker: toggle('tracker'),
    band: toggle('band'),
    bandPreview: () => (
      <OrchestratorGameScenePreview
        config={{ ...config, mode: shownOrchestratorGameModeOf(config) }}
      />
    ),
    render: () => (
      <OrchestratorGameRenderRow
        value={layer?.render ?? 'classic'}
        onChange={(next) => set('render', next)}
      />
    )
  }
  return <Groups shown={shown} draw={draw} />
}

/** This machine's override of one project's terminal panes, each row with its layer. */
export function ProjectTerminalGroups({
  repoId,
  settings,
  projectLayer,
  shown,
  fileScene,
  terminalHeading,
  updateSettings
}: {
  repoId: string
  settings: GameSettings
  projectLayer: OrchestratorGameLayer | undefined
  shown: ReadonlySet<GameRowId>
  fileScene: SceneFileState | null
  terminalHeading: React.ReactNode
  updateSettings: Update
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
  const labels = orchestratorGameModeLabels()
  const inherit = orchestratorGameInheritLabel()
  const effective = (key: keyof OrchestratorGameConfig, text: string): string =>
    `${text} · ${orchestratorGameSourceLabel(sources[key])}`
  const toggle = (key: ToggleKey) => () => {
    const one = switchOf(key)
    const own = local?.[key]
    return (
      <SettingsRow
        label={one.label}
        description={effective(key, config[key] ? labels.on : labels.off)}
        control={
          <SettingsSegmentedControl
            value={own === undefined ? 'inherit' : String(own)}
            ariaLabel={one.label}
            size="sm"
            options={[
              { value: 'inherit', label: inherit },
              { value: 'true', label: labels.on },
              { value: 'false', label: labels.off }
            ]}
            onChange={(next) => set(key, next === 'inherit' ? undefined : next === 'true')}
          />
        }
      />
    )
  }
  const viewRow = (only: 'show' | 'view') => () => (
    <ProjectOrchestratorGameViewRows
      repoId={repoId}
      settings={settings}
      projectLayer={projectLayer}
      updateSettings={updateSettings}
      only={only}
    />
  )
  const draw: GameRowDrawers = {
    show: viewRow('show'),
    view: viewRow('view'),
    hud: toggle('hud'),
    rewards: toggle('rewards'),
    openLinks: () => (
      <OrchestratorGameOpenLinksRow
        value={local?.openLinks ?? 'inherit'}
        effective={effective('openLinks', orchestratorGameOpenLinksLabels()[config.openLinks])}
        onChange={(next) => set('openLinks', next === 'inherit' ? undefined : next)}
      />
    ),
    tracker: toggle('tracker'),
    band: toggle('band'),
    bandPreview: () => (
      <OrchestratorGameScenePreview
        config={{ ...config, mode: shownOrchestratorGameModeOf(config) }}
        fileScene={fileScene}
      />
    ),
    render: () => (
      <OrchestratorGameRenderRow
        value={local?.render ?? 'inherit'}
        effective={effective('render', orchestratorGameRenderLabels()[config.render])}
        onChange={(next) => set('render', next === 'inherit' ? undefined : next)}
      />
    )
  }
  return <Groups shown={shown} draw={draw} terminalHeading={terminalHeading} />
}

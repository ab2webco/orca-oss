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
import type { SceneFileState } from './use-orchestrator-game-scene-file'
import { SettingsSwitchRow } from './SettingsFormControls'
import {
  orchestratorGameModeLabels,
  orchestratorGameSourceLabel
} from './orchestrator-game-setting-labels'
import { InheritableSegmentedRow } from './InheritableSettingRow'
import {
  OrchestratorGameOpenLinksRow,
  openLinksLabel,
  orchestratorGameOpenLinksLabels
} from './OrchestratorGameOpenLinksSetting'
import {
  OrchestratorGameRenderRow,
  orchestratorGameRenderLabels,
  renderLabel
} from './OrchestratorGameRenderSetting'
import { OrchestratorGameScenePreview, scenePreviewModeOf } from './OrchestratorGameScenePreview'
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

/** The HUD a pane draws needs the band too, so turning it on stores both (ORCA-1112 D2). */
function withHud(
  layer: OrchestratorGameLayer | undefined,
  on: boolean,
  band: boolean
): OrchestratorGameLayer {
  const next = withOrchestratorGameField(layer, 'hud', on)
  return on && !band ? withOrchestratorGameField(next, 'band', true) : next
}

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
  const hud = config.band && config.hud
  const draw: GameRowDrawers = {
    show: () => <OrchestratorGameShowRow settings={settings} updateSettings={updateSettings} />,
    view: () => (
      <OrchestratorGameDefaultViewRow settings={settings} updateSettings={updateSettings} />
    ),
    hud: () => (
      <SettingsSwitchRow
        label={switchOf('hud').label}
        description={switchOf('hud').description}
        checked={hud}
        onChange={() => updateSettings({ orchestratorGame: withHud(layer, !hud, config.band) })}
      />
    ),
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
      <OrchestratorGameScenePreview config={{ ...config, mode: scenePreviewModeOf(config.mode) }} />
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
  const layers = { global: settings.orchestratorGame, project: projectLayer, local }
  const { config, sources } = resolveOrchestratorGameConfig(layers)
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
  const onOff = [
    { value: 'true', label: labels.on },
    { value: 'false', label: labels.off }
  ]
  const choice = (args: {
    key: keyof OrchestratorGameConfig
    label: string
    options: { value: string; label: string }[]
    appliedOf?: (resolved: OrchestratorGameConfig) => string
    sourceKeyOf?: (resolved: OrchestratorGameConfig) => keyof OrchestratorGameConfig
    /** Keys this row also writes for this machine, cleared with it on Reset. */
    alsoKeys?: (keyof OrchestratorGameConfig)[]
    onPick: (next: string | undefined) => void
  }) => {
    const appliedOf = args.appliedOf ?? ((resolved) => String(resolved[args.key]))
    const sourceKeyOf = args.sourceKeyOf ?? (() => args.key)
    // Why without this machine's value only: the inherited row is what Reset gives back.
    const keys = [args.key, ...(args.alsoKeys ?? [])]
    const below = resolveOrchestratorGameConfig({
      ...layers,
      local: keys.reduce((one, key) => withOrchestratorGameField(one, key, undefined), local)
    })
    const inherited = appliedOf(below.config)
    return (
      <InheritableSegmentedRow
        label={args.label}
        options={args.options}
        applied={appliedOf(config)}
        source={orchestratorGameSourceLabel(sources[sourceKeyOf(config)])}
        inherited={{
          value: inherited,
          label: args.options.find((one) => one.value === inherited)?.label ?? inherited,
          source: orchestratorGameSourceLabel(below.sources[sourceKeyOf(below.config)])
        }}
        isOverridden={keys.some((key) => local?.[key] !== undefined)}
        onPick={args.onPick}
      />
    )
  }
  const toggle = (key: ToggleKey) => () =>
    choice({
      key,
      label: switchOf(key).label,
      options: onOff,
      onPick: (next) => set(key, next === undefined ? undefined : next === 'true')
    })
  // Why: with the band row hidden, the band:true the HUD row wrote is the HUD row's to clear.
  const hudOwnsBand = !shown.has('band')
  const setHud = (next: boolean | undefined): void => {
    const projects = settings.orchestratorGameProjects
    const withOwn = withOrchestratorGameProjectField(projects, repoId, 'hud', next)
    updateSettings({
      orchestratorGameProjects:
        next === undefined && hudOwnsBand
          ? withOrchestratorGameProjectField(withOwn, repoId, 'band', undefined)
          : next === true && !config.band
            ? withOrchestratorGameProjectField(withOwn, repoId, 'band', true)
            : withOwn
    })
  }
  const linkLabels = orchestratorGameOpenLinksLabels()
  const renderLabels = orchestratorGameRenderLabels()
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
    // Why band && hud: with the band off a pane draws no HUD (shownOrchestratorGameTerminalOf).
    hud: () =>
      choice({
        key: 'hud',
        label: switchOf('hud').label,
        options: onOff,
        appliedOf: (resolved) => String(resolved.band && resolved.hud),
        sourceKeyOf: (resolved) => (resolved.band ? 'hud' : 'band'),
        alsoKeys: hudOwnsBand ? ['band'] : [],
        onPick: (next) => setHud(next === undefined ? undefined : next === 'true')
      }),
    rewards: toggle('rewards'),
    openLinks: () =>
      choice({
        key: 'openLinks',
        label: openLinksLabel(),
        options: [
          { value: 'orca', label: linkLabels.orca },
          { value: 'system', label: linkLabels.system }
        ],
        onPick: (next) => set('openLinks', next as OrchestratorGameConfig['openLinks'] | undefined)
      }),
    tracker: toggle('tracker'),
    band: toggle('band'),
    bandPreview: () => (
      <OrchestratorGameScenePreview
        config={{ ...config, mode: scenePreviewModeOf(config.mode) }}
        fileScene={fileScene}
      />
    ),
    render: () =>
      choice({
        key: 'render',
        label: renderLabel(),
        options: (['classic', 'hd', 'hd-compact'] as const).map((value) => ({
          value,
          label: renderLabels[value]
        })),
        onPick: (next) => set('render', next as OrchestratorGameConfig['render'] | undefined)
      })
  }
  return <Groups shown={shown} draw={draw} terminalHeading={terminalHeading} />
}

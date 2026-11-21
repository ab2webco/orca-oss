import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  resolveOrchestratorGameConfig,
  type OrchestratorGameConfig,
  type OrchestratorGameLayer,
  type OrchestratorGameSource
} from '../../../../shared/orchestrator-game-config'
import {
  withOrchestratorGameField,
  withOrchestratorGameProjectField
} from '../../../../shared/orchestrator-game-settings-updates'
import {
  ORCHESTRATOR_GAME_VIEWS,
  orchestratorGameViewOf,
  isOrchestratorGamePixelView,
  orchestratorGameViewPatchOf,
  type OrchestratorGameViewCost,
  type OrchestratorGameViewId
} from '../../../../shared/orchestrator-game-view'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { SettingsRow, SettingsSwitchRow } from './SettingsFormControls'
import {
  orchestratorGameModeLabels,
  orchestratorGameSourceLabel
} from './orchestrator-game-setting-labels'
import { translate } from '@/i18n/i18n'
import { InheritableSegmentedRow, InheritedSourceLine } from './InheritableSettingRow'

type GameSettings = Pick<GlobalSettings, 'orchestratorGame' | 'orchestratorGameProjects'>

const viewLabels = (): Record<OrchestratorGameViewId, string> => ({
  off: translate('auto.components.settings.OrchestratorGameViewSetting.off', 'Off'),
  flat: translate('auto.components.settings.OrchestratorGameViewSetting.flat', 'Flat'),
  zen: translate('auto.components.settings.OrchestratorGameViewSetting.zen', 'Zen'),
  '2d-classic': translate(
    'auto.components.settings.OrchestratorGameViewSetting.classic',
    '2D classic'
  ),
  '2d-hd': translate('auto.components.settings.OrchestratorGameViewSetting.hd', '2D hd')
})

const costLabels = (): Record<OrchestratorGameViewCost, string> => ({
  light: translate('auto.components.settings.OrchestratorGameViewSetting.light', 'light'),
  medium: translate('auto.components.settings.OrchestratorGameViewSetting.medium', 'medium'),
  heavy: translate('auto.components.settings.OrchestratorGameViewSetting.heavy', 'heavy')
})

/** The views of the shared table, in its order, each named with its cost. */
export const orchestratorGameViewOptions = (): {
  value: OrchestratorGameViewId
  label: string
}[] => {
  const names = viewLabels()
  const costs = costLabels()
  return ORCHESTRATOR_GAME_VIEWS.map((view) => ({
    value: view.id,
    label: `${names[view.id]} · ${costs[view.cost]}`
  }))
}

const showTitle = (): string =>
  translate('auto.components.settings.OrchestratorGameViewSetting.show', 'Show the game')

const viewTitle = (): string =>
  translate('auto.components.settings.OrchestratorGameViewSetting.view', 'Default view')

const PRECEDENCE: readonly OrchestratorGameSource[] = ['default', 'global', 'project', 'local']

// Why the later of two: a 2D view is mode on plus a render, which can come from different layers.
const viewSourceOf = (
  config: OrchestratorGameConfig,
  sources: Record<keyof OrchestratorGameConfig, OrchestratorGameSource>
): OrchestratorGameSource =>
  config.mode !== 'on' || PRECEDENCE.indexOf(sources.mode) >= PRECEDENCE.indexOf(sources.render)
    ? sources.mode
    : sources.render

/** The layer with a view stored as its mode and render, or with both dropped to inherit. */
function withView(
  layer: OrchestratorGameLayer | undefined,
  view: OrchestratorGameViewId | null,
  now: OrchestratorGameConfig
): OrchestratorGameLayer {
  if (view === null) {
    return withOrchestratorGameField(
      withOrchestratorGameField(layer, 'mode', undefined),
      'render',
      undefined
    )
  }
  const patch = orchestratorGameViewPatchOf(view, now)
  const moded = withOrchestratorGameField(layer, 'mode', patch.mode)
  const rendered =
    patch.render === undefined ? moded : withOrchestratorGameField(moded, 'render', patch.render)
  // Why: a view that draws changes nothing on screen while the band is off.
  return isOrchestratorGamePixelView(view) && !now.band
    ? withOrchestratorGameField(rendered, 'band', true)
    : rendered
}

function ViewSelect({
  value,
  onChange
}: {
  value: OrchestratorGameViewId
  onChange: (view: OrchestratorGameViewId) => void
}): React.JSX.Element {
  const options = orchestratorGameViewOptions()
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        const view = options.find((one) => one.value === next)?.value
        if (view !== undefined) {
          onChange(view)
        }
      }}
    >
      <SelectTrigger aria-label={viewTitle()} className="w-48 max-w-full" size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" side="bottom" sideOffset={4}>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

type GlobalRowProps = {
  settings: Partial<GameSettings>
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

/** Show the game for every project. */
export function OrchestratorGameShowRow({
  settings,
  updateSettings
}: GlobalRowProps): React.JSX.Element {
  const layer = settings.orchestratorGame
  const { config } = resolveOrchestratorGameConfig({ global: layer })
  return (
    <SettingsSwitchRow
      label={showTitle()}
      description={translate(
        'auto.components.settings.OrchestratorGameViewSetting.showDescription',
        'Off starts Agent Teams panes as plain Claude and keeps the default view for when it is back on.'
      )}
      checked={config.show}
      onChange={() =>
        updateSettings({
          orchestratorGame: withOrchestratorGameField(layer, 'show', !config.show)
        })
      }
    />
  )
}

/** The default view for every project. */
export function OrchestratorGameDefaultViewRow({
  settings,
  updateSettings
}: GlobalRowProps): React.JSX.Element {
  const layer = settings.orchestratorGame
  const { config } = resolveOrchestratorGameConfig({ global: layer })
  return (
    <SettingsRow
      label={viewTitle()}
      description={translate(
        'auto.components.settings.OrchestratorGameViewSetting.viewDescription',
        'How Agent Teams terminal panes draw the game, with what it costs. The Team panel follows it until you pick a Panel look. Each project can change it, and one pane with /orca-game:view.'
      )}
      control={
        <ViewSelect
          value={orchestratorGameViewOf(config)}
          onChange={(view) => updateSettings({ orchestratorGame: withView(layer, view, config) })}
        />
      }
    />
  )
}

/** Show the game and the default view for every project. */
export function OrchestratorGameViewRows(props: GlobalRowProps): React.JSX.Element {
  return (
    <>
      <OrchestratorGameShowRow {...props} />
      <OrchestratorGameDefaultViewRow {...props} />
    </>
  )
}

type ProjectRowProps = {
  repoId: string
  settings: Partial<GameSettings>
  projectLayer: OrchestratorGameLayer | undefined
  updateSettings: (updates: Partial<GlobalSettings>) => void
  /** Draw only one of the two rows; both when omitted. */
  only?: 'show' | 'view'
}

/** Show the game and the default view for one project on this machine, with their layers. */
export function ProjectOrchestratorGameViewRows({
  repoId,
  settings,
  projectLayer,
  updateSettings,
  only
}: ProjectRowProps): React.JSX.Element {
  const local = settings.orchestratorGameProjects?.[repoId]
  const layers = { global: settings.orchestratorGame, project: projectLayer, local }
  const { config, sources } = resolveOrchestratorGameConfig(layers)
  const onOff = orchestratorGameModeLabels()
  const view = orchestratorGameViewOf(config)
  const writeLocal = (next: OrchestratorGameLayer): void => {
    const projects = { ...settings.orchestratorGameProjects }
    if (Object.keys(next).length === 0) {
      delete projects[repoId]
    } else {
      projects[repoId] = next
    }
    updateSettings({ orchestratorGameProjects: projects })
  }
  const belowShow = resolveOrchestratorGameConfig({
    ...layers,
    local: withOrchestratorGameField(local, 'show', undefined)
  })
  // Why both keys: a view is stored as mode and render, and Reset drops both.
  const belowView = resolveOrchestratorGameConfig({
    ...layers,
    local: withView(local, null, config)
  })
  const inheritedView = orchestratorGameViewOf(belowView.config)
  const pickView = (next: OrchestratorGameViewId | null): void => {
    const cleared = withView(local, next === inheritedView ? null : next, config)
    // Why: the inherited pixel view draws nothing while the band below it is off.
    const needsBand =
      next !== null &&
      next === inheritedView &&
      isOrchestratorGamePixelView(next) &&
      !belowView.config.band
    writeLocal(needsBand ? withOrchestratorGameField(cleared, 'band', true) : cleared)
  }
  return (
    <>
      {only === 'view' ? null : (
        <InheritableSegmentedRow
          label={showTitle()}
          options={[
            { value: 'true', label: onOff.on },
            { value: 'false', label: onOff.off }
          ]}
          applied={String(config.show)}
          source={orchestratorGameSourceLabel(sources.show)}
          inherited={{
            value: String(belowShow.config.show),
            label: belowShow.config.show ? onOff.on : onOff.off,
            source: orchestratorGameSourceLabel(belowShow.sources.show)
          }}
          isOverridden={local?.show !== undefined}
          onPick={(next) =>
            updateSettings({
              orchestratorGameProjects: withOrchestratorGameProjectField(
                settings.orchestratorGameProjects,
                repoId,
                'show',
                next === undefined ? undefined : next === 'true'
              )
            })
          }
        />
      )}
      {only === 'show' ? null : (
        <SettingsRow
          label={viewTitle()}
          description={
            <InheritedSourceLine
              applied={viewLabels()[view]}
              source={orchestratorGameSourceLabel(viewSourceOf(config, sources))}
              inherited={{
                value: inheritedView,
                label: viewLabels()[inheritedView],
                source: orchestratorGameSourceLabel(
                  viewSourceOf(belowView.config, belowView.sources)
                )
              }}
              isOverridden={local?.mode !== undefined || local?.render !== undefined}
              onReset={() => pickView(null)}
            />
          }
          control={<ViewSelect value={view} onChange={pickView} />}
        />
      )}
    </>
  )
}

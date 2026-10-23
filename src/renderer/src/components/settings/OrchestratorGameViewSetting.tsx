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
  orchestratorGameViewPatchOf,
  type OrchestratorGameViewCost,
  type OrchestratorGameViewId
} from '../../../../shared/orchestrator-game-view'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { SettingsRow, SettingsSegmentedControl, SettingsSwitchRow } from './SettingsFormControls'
import {
  orchestratorGameInheritLabel,
  orchestratorGameModeLabels,
  orchestratorGameSourceLabel
} from './orchestrator-game-setting-labels'
import { translate } from '@/i18n/i18n'

type GameSettings = Pick<GlobalSettings, 'orchestratorGame' | 'orchestratorGameProjects'>

const INHERIT = 'inherit'

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
  return patch.render === undefined
    ? moded
    : withOrchestratorGameField(moded, 'render', patch.render)
}

function ViewSelect({
  value,
  withInherit,
  onChange
}: {
  value: OrchestratorGameViewId | typeof INHERIT
  withInherit: boolean
  onChange: (view: OrchestratorGameViewId | null) => void
}): React.JSX.Element {
  const options = orchestratorGameViewOptions()
  return (
    <Select
      value={value}
      onValueChange={(next) =>
        onChange(
          next === INHERIT ? null : (options.find((one) => one.value === next)?.value ?? null)
        )
      }
    >
      <SelectTrigger aria-label={viewTitle()} className="w-48 max-w-full" size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" side="bottom" sideOffset={4}>
        {withInherit ? (
          <SelectItem value={INHERIT}>{orchestratorGameInheritLabel()}</SelectItem>
        ) : null}
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Show the game and the default view for every project. */
export function OrchestratorGameViewRows({
  settings,
  updateSettings
}: {
  settings: Partial<GameSettings>
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element {
  const layer = settings.orchestratorGame
  const { config } = resolveOrchestratorGameConfig({ global: layer })
  return (
    <>
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
      <SettingsRow
        label={viewTitle()}
        description={translate(
          'auto.components.settings.OrchestratorGameViewSetting.viewDescription',
          'How panes draw the game, with what it costs. Each project can change it, and one pane with /orca-game:view.'
        )}
        control={
          <ViewSelect
            value={orchestratorGameViewOf(config)}
            withInherit={false}
            onChange={(view) => updateSettings({ orchestratorGame: withView(layer, view, config) })}
          />
        }
      />
    </>
  )
}

/** Show the game and the default view for one project on this machine, with their layers. */
export function ProjectOrchestratorGameViewRows({
  repoId,
  settings,
  projectLayer,
  updateSettings
}: {
  repoId: string
  settings: Partial<GameSettings>
  projectLayer: OrchestratorGameLayer | undefined
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element {
  const local = settings.orchestratorGameProjects?.[repoId]
  const { config, sources } = resolveOrchestratorGameConfig({
    global: settings.orchestratorGame,
    project: projectLayer,
    local
  })
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
  return (
    <>
      <SettingsRow
        label={showTitle()}
        description={`${config.show ? onOff.on : onOff.off} · ${orchestratorGameSourceLabel(sources.show)}`}
        control={
          <SettingsSegmentedControl
            value={local?.show === undefined ? INHERIT : String(local.show)}
            ariaLabel={showTitle()}
            size="sm"
            options={[
              { value: INHERIT, label: orchestratorGameInheritLabel() },
              { value: 'true', label: onOff.on },
              { value: 'false', label: onOff.off }
            ]}
            onChange={(next) =>
              updateSettings({
                orchestratorGameProjects: withOrchestratorGameProjectField(
                  settings.orchestratorGameProjects,
                  repoId,
                  'show',
                  next === INHERIT ? undefined : next === 'true'
                )
              })
            }
          />
        }
      />
      <SettingsRow
        label={viewTitle()}
        description={`${viewLabels()[view]} · ${orchestratorGameSourceLabel(viewSourceOf(config, sources))}`}
        control={
          <ViewSelect
            value={local?.mode === undefined ? INHERIT : view}
            withInherit
            onChange={(next) => writeLocal(withView(local, next, config))}
          />
        }
      />
    </>
  )
}

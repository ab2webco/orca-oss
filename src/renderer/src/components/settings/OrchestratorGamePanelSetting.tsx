import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  ORCHESTRATOR_GAME_LAYER_ORDER,
  type OrchestratorGameLayer,
  type OrchestratorGameSource
} from '../../../../shared/orchestrator-game-config'
import { resolveOrchestratorGamePanel } from '../../../../shared/orchestrator-game-panel-layers'
import {
  GAME_PANEL_LOOKS,
  GAME_PANEL_STYLES,
  GAME_PANEL_TABS,
  parseGamePanel,
  withGamePanelField,
  type GamePanelField,
  type GamePanelLook,
  type GamePanelStyle,
  type GamePanelValue as PanelValue,
  type OrchestratorGamePanel
} from '../../../../shared/orchestrator-game-panel'
import { SearchableSetting } from './SearchableSetting'
import {
  SettingsRow,
  SettingsSegmentedControl,
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from './SettingsFormControls'
import {
  orchestratorGameInheritLabel,
  orchestratorGameModeLabels,
  orchestratorGameSourceLabel
} from './orchestrator-game-setting-labels'
import { getGamePanelSearchEntries } from './orchestrator-game-panel-search'
import { GAME_PANEL_GLOBAL_SECTION_ID } from './repository-settings-targets'
import type { AdvisorPluginPresence } from './use-advisor-plugin-presence'
import { translate } from '@/i18n/i18n'

type GameSettings = Pick<GlobalSettings, 'orchestratorGame' | 'orchestratorGameProjects'>
type Update = (updates: Partial<GlobalSettings>) => void
type Toggle = Exclude<GamePanelField, 'look' | 'style'>

const lookLabels = (): Record<GamePanelLook, string> => ({
  game: translate('auto.components.settings.OrchestratorGamePanelSetting.lookGame', 'Game'),
  display: translate(
    'auto.components.settings.OrchestratorGamePanelSetting.lookDisplay',
    'Display'
  ),
  plain: translate('auto.components.settings.OrchestratorGamePanelSetting.lookPlain', 'Plain')
})

const styleLabels = (): Record<GamePanelStyle, string> => ({
  figures: translate(
    'auto.components.settings.OrchestratorGamePanelSetting.styleFigures',
    'Figures'
  ),
  office: translate('auto.components.settings.OrchestratorGamePanelSetting.styleOffice', 'Office'),
  pixel: translate('auto.components.settings.OrchestratorGamePanelSetting.stylePixel', 'Pixel')
})

const copy = () => ({
  look: [
    translate('auto.components.settings.OrchestratorGamePanelSetting.look', 'Panel look'),
    translate(
      'auto.components.settings.OrchestratorGamePanelSetting.lookDescription',
      'Same data and actions in all three.'
    )
  ],
  style: [
    translate('auto.components.settings.OrchestratorGamePanelSetting.style', 'Scene style'),
    translate(
      'auto.components.settings.OrchestratorGamePanelSetting.styleDescription',
      'They all act out the same real state.'
    )
  ],
  prs: [
    translate('auto.components.settings.OrchestratorGamePanelSetting.prs', 'PRs'),
    translate(
      'auto.components.settings.OrchestratorGamePanelSetting.prsDescription',
      'Tab with your open PRs.'
    )
  ],
  queue: [
    translate('auto.components.settings.OrchestratorGamePanelSetting.queue', 'Queue'),
    translate(
      'auto.components.settings.OrchestratorGamePanelSetting.queueDescription',
      'Tab with the merge queue.'
    )
  ],
  machines: [
    translate('auto.components.settings.OrchestratorGamePanelSetting.machines', 'Machines'),
    translate(
      'auto.components.settings.OrchestratorGamePanelSetting.machinesDescription',
      'Tab with the hosts and their memory.'
    )
  ],
  advisor: [
    translate('auto.components.settings.OrchestratorGamePanelSetting.advisor', 'Advisor'),
    translate(
      'auto.components.settings.OrchestratorGamePanelSetting.advisorDescription',
      'Row under the lead. Shows only when the plugin is installed.'
    )
  ],
  arcade: [
    translate('auto.components.settings.OrchestratorGamePanelSetting.arcade', 'Arcade'),
    translate(
      'auto.components.settings.OrchestratorGamePanelSetting.arcadeDescription',
      'A perfect merge saves a game.'
    )
  ]
})

const showLabel = (label: string): string =>
  translate('auto.components.settings.OrchestratorGamePanelSetting.show', 'Show {{label}}', {
    label
  })

const isTab = (field: GamePanelField): field is (typeof GAME_PANEL_TABS)[number] =>
  (GAME_PANEL_TABS as readonly string[]).includes(field)

const ownOf = (layer: OrchestratorGameLayer | undefined, field: GamePanelField) => {
  const panel = parseGamePanel(layer?.panel ?? {}).value ?? {}
  return isTab(field) ? panel.tabs?.[field] : panel[field]
}

const valueOf = (panel: OrchestratorGamePanel, field: GamePanelField) =>
  isTab(field) ? panel.tabs[field] : panel[field]

// Why parsed: only a key the layer sets validly counts, so a bad hand edit names the layer below.
function sourceOf(
  layers: Partial<Record<Exclude<OrchestratorGameSource, 'default'>, OrchestratorGameLayer>>,
  field: GamePanelField
): OrchestratorGameSource {
  const set = ORCHESTRATOR_GAME_LAYER_ORDER.findLast(
    (source) => ownOf(layers[source], field) !== undefined
  )
  return set ?? 'default'
}

/** The global Panel section under Agents, which the no-team panel's gear opens. */
export function GamePanelSetting({
  settings,
  updateSettings
}: {
  settings: GameSettings
  updateSettings: Update
}): React.JSX.Element {
  const layer = settings.orchestratorGame
  const panel = resolveOrchestratorGamePanel({ global: layer })
  const text = copy()
  const [{ title, description, keywords }] = getGamePanelSearchEntries()
  const set = (field: GamePanelField, value: boolean | string): void =>
    updateSettings({ orchestratorGame: withGamePanelField(layer, field, value as PanelValue) })
  return (
    <SearchableSetting
      id={GAME_PANEL_GLOBAL_SECTION_ID}
      title={title}
      description={description}
      keywords={keywords}
      className="space-y-1"
    >
      <SettingsSubsectionHeader title={title} description={description} />
      {(['look', 'style'] as const)
        .filter((field) => field === 'look' || panel.look === 'game')
        .map((field) => (
          <SettingsRow
            key={field}
            label={text[field][0]}
            description={text[field][1]}
            control={
              <SettingsSegmentedControl
                value={panel[field]}
                ariaLabel={text[field][0]}
                size="sm"
                options={choicesOf(field)}
                onChange={(next) => set(field, next)}
              />
            }
          />
        ))}
      {GAME_PANEL_TABS.map((tab) => (
        <SettingsSwitchRow
          key={tab}
          label={text[tab][0]}
          description={text[tab][1]}
          ariaLabel={showLabel(text[tab][0])}
          checked={panel.tabs[tab]}
          onChange={() => set(tab, !panel.tabs[tab])}
        />
      ))}
    </SearchableSetting>
  )
}

function choicesOf(field: 'look' | 'style'): { value: string; label: string }[] {
  const labels: Record<string, string> = field === 'look' ? lookLabels() : styleLabels()
  return (field === 'look' ? GAME_PANEL_LOOKS : GAME_PANEL_STYLES).map((value) => ({
    value,
    label: labels[value]
  }))
}

/** This machine's override of the panel for one project, each row offering Inherit. */
export function ProjectGamePanelRows({
  repoId,
  settings,
  projectLayer,
  advisorPlugin,
  updateSettings
}: {
  repoId: string
  settings: GameSettings
  projectLayer: OrchestratorGameLayer | undefined
  advisorPlugin: AdvisorPluginPresence
  updateSettings: Update
}): React.JSX.Element {
  const local = settings.orchestratorGameProjects?.[repoId]
  const layers = { global: settings.orchestratorGame, project: projectLayer, local }
  const panel = resolveOrchestratorGamePanel(layers)
  const text = copy()
  const inherit = orchestratorGameInheritLabel()
  const onOff = orchestratorGameModeLabels()
  const named = (field: GamePanelField, value: boolean | string): string => {
    const word =
      typeof value === 'boolean'
        ? value
          ? onOff.on
          : onOff.off
        : ({ ...lookLabels(), ...styleLabels() } as Record<string, string>)[value]
    return `${word} · ${orchestratorGameSourceLabel(sourceOf(layers, field))}`
  }
  const set = (field: GamePanelField, value: boolean | string | undefined): void => {
    const nextLayer = withGamePanelField(local, field, value as PanelValue | undefined)
    const projects = { ...settings.orchestratorGameProjects, [repoId]: nextLayer }
    if (Object.keys(nextLayer).length === 0) {
      delete projects[repoId]
    }
    updateSettings({ orchestratorGameProjects: projects })
  }
  const toggles: Toggle[] = [
    ...GAME_PANEL_TABS,
    ...(advisorPlugin === 'missing' ? [] : (['advisor'] as const)),
    ...(panel.look === 'game' ? (['arcade'] as const) : [])
  ]
  const choices = (field: 'look' | 'style') => [
    { value: 'inherit', label: inherit },
    ...choicesOf(field)
  ]
  const rows: { field: GamePanelField; options: { value: string; label: string }[] }[] = [
    { field: 'look', options: choices('look') },
    ...(panel.look === 'game' ? [{ field: 'style' as const, options: choices('style') }] : []),
    ...toggles.map((field) => ({
      field,
      options: [
        { value: 'inherit', label: inherit },
        { value: 'true', label: onOff.on },
        { value: 'false', label: onOff.off }
      ]
    }))
  ]
  return (
    <>
      {rows.map(({ field, options }) => {
        const own = ownOf(local, field)
        const isToggle = field !== 'look' && field !== 'style'
        const value = own === undefined ? 'inherit' : String(own)
        return (
          <SettingsRow
            key={field}
            label={text[field][0]}
            description={
              <>
                {text[field][1]}
                <span className="block">{named(field, valueOf(panel, field))}</span>
              </>
            }
            control={
              <SettingsSegmentedControl
                value={value}
                ariaLabel={text[field][0]}
                size="sm"
                options={options}
                onChange={(next) =>
                  set(field, next === 'inherit' ? undefined : isToggle ? next === 'true' : next)
                }
              />
            }
          />
        )
      })}
    </>
  )
}

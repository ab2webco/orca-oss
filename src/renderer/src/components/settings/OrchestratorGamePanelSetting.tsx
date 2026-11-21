import { useMemo } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  DEFAULT_ORCHESTRATOR_GAME_CONFIG,
  ORCHESTRATOR_GAME_LAYER_ORDER,
  resolveOrchestratorGameConfig,
  type OrchestratorGameLayer,
  type OrchestratorGameSource
} from '../../../../shared/orchestrator-game-config'
import { resolveOrchestratorGamePanel } from '../../../../shared/orchestrator-game-panel-layers'
import {
  withGamePanelField,
  type GamePanelField,
  type GamePanelStyle,
  type GamePanelTab,
  type GamePanelValue as PanelValue
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
import { gameStyleFallbackNote } from './orchestrator-game-style-fallback-note'
import { GamePanelStylePreview } from './GamePanelStylePreview'
import { OrchestratorGameSceneSelect } from './OrchestratorGameSceneSelect'
import type { OrchestratorGameSceneExtension } from '../../../../shared/orchestrator-game-scene'
import { withOrchestratorGameField } from '../../../../shared/orchestrator-game-settings-updates'
import { gamePanelValueOf, ownGamePanelValueOf } from './game-panel-overrides'
import { GamePanelOverrideNote, useGamePanelOverrideProjects } from './GamePanelOverrideNote'
import { GamePanelDioramaRows, ProjectGamePanelDioramaRows } from './GamePanelDioramaRows'
import { OrchestratorGameTimezoneRow } from './OrchestratorGameRenderSetting'
import { gameRowFactsOf, shownGameRows } from './orchestrator-game-row-visibility'
import { GameRowGroupView, type GameRowDrawers } from './GameRowList'
import {
  gamePanelChoicesOf as choicesOf,
  gamePanelRowCopy as copy,
  gamePanelShowLabel as showLabel,
  gamePanelStyleLabels as styleLabels,
  gamePanelValueNameOf as valueNameOf,
  gameSceneTitle as sceneTitle
} from './game-panel-setting-copy'

type GameSettings = Pick<GlobalSettings, 'orchestratorGame' | 'orchestratorGameProjects'>
type Update = (updates: Partial<GlobalSettings>) => void
type Toggle = GamePanelTab | 'advisor' | 'arcade'

const ownOf = ownGamePanelValueOf
const valueOf = gamePanelValueOf

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
  const sceneId = resolveOrchestratorGameConfig({ global: layer }).config.scene
  const scene = useMemo(() => ({ id: sceneId, extensions: [] }), [sceneId])
  const facts = gameRowFactsOf({ page: 'global', layers: { global: layer } })
  const text = copy()
  const [{ title, description, keywords }] = getGamePanelSearchEntries(facts)
  const set = (field: GamePanelField, value: boolean | string): void =>
    updateSettings({ orchestratorGame: withGamePanelField(layer, field, value as PanelValue) })
  const projects = useGamePanelOverrideProjects(settings)
  const overrideNote = (field: GamePanelField): React.JSX.Element => (
    <GamePanelOverrideNote
      field={field}
      settings={settings}
      projects={projects}
      nameOf={valueNameOf}
      updateSettings={updateSettings}
    />
  )
  const segment = (field: 'look' | 'style') => () => (
    <SettingsRow
      label={text[field][0]}
      description={
        <>
          {text[field][1]}
          <StyleNote field={field} style={panel.style} sceneId={sceneId} />
          {overrideNote(field)}
        </>
      }
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
  )
  const tab = (id: GamePanelTab) => () => (
    <SettingsSwitchRow
      label={text[id][0]}
      description={
        <>
          {text[id][1]}
          {overrideNote(id)}
        </>
      }
      ariaLabel={showLabel(text[id][0])}
      checked={panel.tabs[id]}
      onChange={() => set(id, !panel.tabs[id])}
    />
  )
  const draw: GameRowDrawers = {
    look: segment('look'),
    style: segment('style'),
    stylePreview: () => (
      <GamePanelStylePreview
        style={panel.style}
        scene={scene}
        diorama={panel.diorama}
        lite={panel.quality === 'low'}
      />
    ),
    diorama: () => (
      <GamePanelDioramaRows
        settings={settings}
        panel={panel}
        projects={projects}
        updateSettings={updateSettings}
      />
    ),
    scene: () => (
      <SettingsRow
        label={sceneTitle()}
        description={translate(
          'auto.components.settings.OrchestratorGameSetting.sceneDescription',
          'The art the game draws. Installed plugins can add scenes.'
        )}
        control={
          <OrchestratorGameSceneSelect
            value={sceneId}
            ariaLabel={sceneTitle()}
            onChange={(next) =>
              updateSettings({
                orchestratorGame: withOrchestratorGameField(
                  layer,
                  'scene',
                  next ?? DEFAULT_ORCHESTRATOR_GAME_CONFIG.scene
                )
              })
            }
          />
        }
      />
    ),
    prs: tab('prs'),
    machines: tab('machines'),
    timezone: () => (
      <OrchestratorGameTimezoneRow
        key={layer?.timezone ?? ''}
        stored={layer?.timezone ?? ''}
        onCommit={(value) =>
          updateSettings({ orchestratorGame: withOrchestratorGameField(layer, 'timezone', value) })
        }
      />
    )
  }
  return (
    <SearchableSetting
      id={GAME_PANEL_GLOBAL_SECTION_ID}
      title={title}
      description={description}
      keywords={keywords}
      className="space-y-1"
    >
      <SettingsSubsectionHeader title={title} description={description} />
      <GameRowGroupView group="panel" shown={shownGameRows(facts)} draw={draw} />
    </SearchableSetting>
  )
}

function StyleNote(p: { field: GamePanelField; style: GamePanelStyle; sceneId: string }) {
  const note =
    p.field === 'style' ? gameStyleFallbackNote(p.style, p.sceneId, styleLabels()[p.style]) : null
  return note ? <span className="block">{note}</span> : null
}

/** This machine's override of the panel for one project, each row offering Inherit. */
export function ProjectGamePanelRows({
  repoId,
  settings,
  projectLayer,
  advisorPlugin,
  scene,
  drawers,
  updateSettings
}: {
  repoId: string
  settings: GameSettings
  projectLayer: OrchestratorGameLayer | undefined
  advisorPlugin: AdvisorPluginPresence
  /** The project's scene with a custom file's definition; without it the preview resolves the id. */
  scene?: { id: string; extensions: OrchestratorGameSceneExtension[] }
  /** Rows of the Panel group the project page draws itself (scene, time zone). */
  drawers?: GameRowDrawers
  updateSettings: Update
}): React.JSX.Element | null {
  const local = settings.orchestratorGameProjects?.[repoId]
  const layers = { global: settings.orchestratorGame, project: projectLayer, local }
  const panel = resolveOrchestratorGamePanel(layers)
  const sceneId = resolveOrchestratorGameConfig(layers).config.scene
  const ownScene = useMemo(() => ({ id: sceneId, extensions: [] }), [sceneId])
  const shownScene = scene ?? ownScene
  const shown = shownGameRows(gameRowFactsOf({ page: 'project', layers, advisorPlugin }))
  const text = copy()
  const inherit = orchestratorGameInheritLabel()
  const onOff = orchestratorGameModeLabels()
  const named = (field: GamePanelField, value: PanelValue): string => {
    const line = `${valueNameOf(value)} · ${orchestratorGameSourceLabel(sourceOf(layers, field))}`
    // Why named: the band preview below also draws pixels, and only this row sets the Team panel.
    return field === 'look'
      ? translate(
          'auto.components.settings.OrchestratorGamePanelSetting.teamPanelLook',
          'Team panel: {{look}}',
          { look: line }
        )
      : line
  }
  const set = (field: GamePanelField, value: boolean | string | undefined): void => {
    const nextLayer = withGamePanelField(local, field, value as PanelValue | undefined)
    const projects = { ...settings.orchestratorGameProjects, [repoId]: nextLayer }
    if (Object.keys(nextLayer).length === 0) {
      delete projects[repoId]
    }
    updateSettings({ orchestratorGameProjects: projects })
  }
  const row = (field: 'look' | 'style' | Toggle) => () => {
    const isToggle = field !== 'look' && field !== 'style'
    const own = ownOf(local, field)
    const options = isToggle
      ? [
          { value: 'inherit', label: inherit },
          { value: 'true', label: onOff.on },
          { value: 'false', label: onOff.off }
        ]
      : [{ value: 'inherit', label: inherit }, ...choicesOf(field)]
    return (
      <SettingsRow
        label={text[field][0]}
        description={
          <>
            {text[field][1]}
            <span className="block">{named(field, valueOf(panel, field))}</span>
            <StyleNote field={field} style={panel.style} sceneId={sceneId} />
          </>
        }
        control={
          <SettingsSegmentedControl
            value={own === undefined ? 'inherit' : String(own)}
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
  }
  const draw: GameRowDrawers = {
    look: row('look'),
    style: row('style'),
    stylePreview: () => (
      <GamePanelStylePreview
        style={panel.style}
        scene={shownScene}
        diorama={panel.diorama}
        lite={panel.quality === 'low'}
      />
    ),
    diorama: () => <ProjectGamePanelDioramaRows layers={layers} panel={panel} set={set} />,
    prs: row('prs'),
    machines: row('machines'),
    advisor: row('advisor'),
    arcade: row('arcade'),
    ...drawers
  }
  return <GameRowGroupView group="panel" shown={shown} draw={draw} />
}

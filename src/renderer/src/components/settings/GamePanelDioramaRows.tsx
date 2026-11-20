import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  ORCHESTRATOR_GAME_LAYER_ORDER,
  type OrchestratorGameLayer
} from '../../../../shared/orchestrator-game-config'
import {
  GAME_PANEL_PACES,
  GAME_PANEL_QUALITIES,
  withGamePanelField,
  type GamePanelValue,
  type OrchestratorGamePanel
} from '../../../../shared/orchestrator-game-panel'
import { SettingsRow, SettingsSegmentedControl } from './SettingsFormControls'
import {
  orchestratorGameInheritLabel,
  orchestratorGameSourceLabel
} from './orchestrator-game-setting-labels'
import { ownGamePanelValueOf } from './game-panel-overrides'
import { GamePanelOverrideNote, type GamePanelOverrideProject } from './GamePanelOverrideNote'
import { translate } from '@/i18n/i18n'

// Why rows of their own: quality and pace change only the Figures diorama (ORCA-1296), so they
// show only while it draws.

type GameSettings = Pick<GlobalSettings, 'orchestratorGame' | 'orchestratorGameProjects'>
type Update = (updates: Partial<GlobalSettings>) => void
type Field = 'quality' | 'pace'

const valueLabels = (): Record<string, string> => ({
  high: translate('auto.components.settings.GamePanelDioramaRows.qualityHigh', 'Illustrated'),
  low: translate('auto.components.settings.GamePanelDioramaRows.qualityLow', 'Low resources'),
  normal: translate('auto.components.settings.GamePanelDioramaRows.paceNormal', 'Normal'),
  fast: translate('auto.components.settings.GamePanelDioramaRows.paceFast', 'Fast'),
  direct: translate('auto.components.settings.GamePanelDioramaRows.paceDirect', 'Direct')
})

const copy = (): Record<Field, [string, string]> => ({
  quality: [
    translate('auto.components.settings.GamePanelDioramaRows.quality', 'Scene quality'),
    translate(
      'auto.components.settings.GamePanelDioramaRows.qualityDescription',
      'Illustrated draws outlined figures with shadows. Low resources draws flat ones without shadows, for slower machines.'
    )
  ],
  pace: [
    translate('auto.components.settings.GamePanelDioramaRows.pace', "Lead's pace"),
    translate(
      'auto.components.settings.GamePanelDioramaRows.paceDescription',
      'How the lead gets round the base: walking, faster, or sent by the court mage.'
    )
  ]
})

const choicesOf = (field: Field) =>
  (field === 'quality' ? GAME_PANEL_QUALITIES : GAME_PANEL_PACES).map((value) => ({
    value,
    label: valueLabels()[value]!
  }))

/** Whether the rows apply: the Game look drawing Figures as the diorama. */
export const dioramaRowsShown = (panel: OrchestratorGamePanel): boolean =>
  panel.look === 'game' && panel.style === 'figures' && panel.diorama

/** The global rows, each with the projects that override it. */
export function GamePanelDioramaRows(p: {
  settings: GameSettings
  panel: OrchestratorGamePanel
  projects: readonly GamePanelOverrideProject[]
  updateSettings: Update
}): React.JSX.Element {
  const text = copy()
  const layer = p.settings.orchestratorGame
  return (
    <>
      {(['quality', 'pace'] as const).map((field) => (
        <SettingsRow
          key={field}
          label={text[field][0]}
          description={
            <>
              {text[field][1]}
              <GamePanelOverrideNote
                field={field}
                settings={p.settings}
                projects={p.projects}
                nameOf={(value: GamePanelValue) => valueLabels()[String(value)] ?? String(value)}
                updateSettings={p.updateSettings}
              />
            </>
          }
          control={
            <SettingsSegmentedControl
              value={p.panel[field]}
              ariaLabel={text[field][0]}
              size="sm"
              options={choicesOf(field)}
              onChange={(next) =>
                p.updateSettings({
                  orchestratorGame: withGamePanelField(layer, field, next as GamePanelValue)
                })
              }
            />
          }
        />
      ))}
    </>
  )
}

/** This machine's override for one project, each row offering Inherit. */
export function ProjectGamePanelDioramaRows(p: {
  layers: Partial<Record<'global' | 'project' | 'local', OrchestratorGameLayer>>
  panel: OrchestratorGamePanel
  set: (field: Field, value: string | undefined) => void
}): React.JSX.Element {
  const text = copy()
  return (
    <>
      {(['quality', 'pace'] as const).map((field) => {
        const own = ownGamePanelValueOf(p.layers.local, field)
        const source =
          ORCHESTRATOR_GAME_LAYER_ORDER.findLast(
            (one) => ownGamePanelValueOf(p.layers[one], field) !== undefined
          ) ?? 'default'
        return (
          <SettingsRow
            key={field}
            label={text[field][0]}
            description={
              <>
                {text[field][1]}
                <span className="block">
                  {`${valueLabels()[p.panel[field]]} · ${orchestratorGameSourceLabel(source)}`}
                </span>
              </>
            }
            control={
              <SettingsSegmentedControl
                value={own === undefined ? 'inherit' : String(own)}
                ariaLabel={text[field][0]}
                size="sm"
                options={[
                  { value: 'inherit', label: orchestratorGameInheritLabel() },
                  ...choicesOf(field)
                ]}
                onChange={(next) => p.set(field, next === 'inherit' ? undefined : next)}
              />
            }
          />
        )
      })}
    </>
  )
}

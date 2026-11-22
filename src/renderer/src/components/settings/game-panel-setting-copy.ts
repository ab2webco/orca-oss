import {
  GAME_PANEL_LOOKS,
  GAME_PANEL_STYLES,
  type GamePanelLook,
  type GamePanelStyle,
  type GamePanelValue
} from '../../../../shared/orchestrator-game-panel'
import { orchestratorGameModeLabels } from './orchestrator-game-setting-labels'
import { translate } from '@/i18n/i18n'

export const gamePanelLookLabels = (): Record<GamePanelLook, string> => ({
  game: translate('auto.components.settings.OrchestratorGamePanelSetting.lookGame', 'Game'),
  display: translate(
    'auto.components.settings.OrchestratorGamePanelSetting.lookDisplay',
    'Display'
  ),
  plain: translate('auto.components.settings.OrchestratorGamePanelSetting.lookPlain', 'Plain')
})

export const gamePanelStyleLabels = (): Record<GamePanelStyle, string> => ({
  figures: translate(
    'auto.components.settings.OrchestratorGamePanelSetting.styleFigures',
    'Figures'
  ),
  office: translate('auto.components.settings.OrchestratorGamePanelSetting.styleOffice', 'Office'),
  pixel: translate('auto.components.settings.OrchestratorGamePanelSetting.stylePixel', 'Pixel')
})

/** Label and description of each panel row. */
export const gamePanelRowCopy = () => ({
  look: [
    translate('auto.components.settings.OrchestratorGamePanelSetting.look', 'Panel look'),
    translate(
      'auto.components.settings.OrchestratorGamePanelSetting.lookDescription',
      'The Team panel in the right sidebar; Default view sets the terminal panes. Same data and actions in all three.'
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
      'Tab with your open PRs. The merge queue shows at the top when there is one.'
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

export const gameSceneTitle = (): string =>
  translate('auto.components.settings.OrchestratorGameSetting.scene', 'Scene')

export const gamePanelShowLabel = (label: string): string =>
  translate('auto.components.settings.OrchestratorGamePanelSetting.show', 'Show {{label}}', {
    label
  })

export const gamePanelValueNameOf = (value: GamePanelValue): string => {
  if (typeof value === 'boolean') {
    const onOff = orchestratorGameModeLabels()
    return value ? onOff.on : onOff.off
  }
  return ({ ...gamePanelLookLabels(), ...gamePanelStyleLabels() } as Record<string, string>)[value]
}

export function gamePanelChoicesOf(field: 'look' | 'style'): { value: string; label: string }[] {
  const labels: Record<string, string> =
    field === 'look' ? gamePanelLookLabels() : gamePanelStyleLabels()
  return (field === 'look' ? GAME_PANEL_LOOKS : GAME_PANEL_STYLES).map((value) => ({
    value,
    label: labels[value]
  }))
}

import { SettingsSubsectionHeader } from './SettingsFormControls'
import { translate } from '@/i18n/i18n'

export const terminalBandTitle = (): string =>
  translate('auto.components.settings.OrchestratorGameSetting.terminalBand', 'Terminal band')

/** The band group's heading: what Agent Teams panes draw, apart from the Team panel's look. */
export function TerminalBandHeading(): React.JSX.Element {
  return (
    <SettingsSubsectionHeader
      title={terminalBandTitle()}
      description={translate(
        'auto.components.settings.OrchestratorGameSetting.terminalBandDescription',
        'Drawn at the top of each Agent Teams terminal pane. The Team panel uses Panel look.'
      )}
    />
  )
}

/** The project page's heading for the terminal rows, which follow Actions, Names and Lead. */
export function TerminalPanesHeading(): React.JSX.Element {
  return (
    <SettingsSubsectionHeader
      title={translate(
        'auto.components.settings.OrchestratorGameTerminalBand.terminalPanes',
        'Terminal panes'
      )}
      description={translate(
        'auto.components.settings.OrchestratorGameTerminalBand.terminalPanesDescription',
        'How Agent Teams terminal panes start and draw the game on this machine.'
      )}
    />
  )
}

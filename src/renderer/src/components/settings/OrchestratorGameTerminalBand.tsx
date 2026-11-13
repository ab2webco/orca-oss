import { SettingsSubsectionHeader } from './SettingsFormControls'
import { translate } from '@/i18n/i18n'

const bandTitle = (): string =>
  translate('auto.components.settings.OrchestratorGameSetting.terminalBand', 'Terminal band')

/** What Agent Teams panes draw, apart from the Team panel's own look and style. */
export function TerminalBandGroup({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div role="group" aria-label={bandTitle()} className="space-y-1 pt-4">
      <SettingsSubsectionHeader title={bandTitle()} />
      {children}
    </div>
  )
}

import type { OrchestratorGameOpenLinks } from '../../../../shared/orchestrator-game-config'
import { SettingsRow, SettingsSegmentedControl } from './SettingsFormControls'
import { translate } from '@/i18n/i18n'

export const orchestratorGameOpenLinksLabels = (): Record<OrchestratorGameOpenLinks, string> => ({
  orca: translate('auto.components.settings.OrchestratorGameOpenLinksSetting.orca', 'Orca'),
  system: translate(
    'auto.components.settings.OrchestratorGameOpenLinksSetting.system',
    'System browser'
  )
})

export const openLinksLabel = (): string =>
  translate('auto.components.settings.OrchestratorGameOpenLinksSetting.label', 'Open links in')

/** Where every project's game links open; a project row is an InheritableSegmentedRow. */
export function OrchestratorGameOpenLinksRow({
  value,
  onChange
}: {
  value: OrchestratorGameOpenLinks
  onChange: (next: OrchestratorGameOpenLinks) => void
}): React.JSX.Element {
  const label = openLinksLabel()
  const labels = orchestratorGameOpenLinksLabels()
  return (
    <SettingsRow
      label={label}
      description={translate(
        'auto.components.settings.OrchestratorGameOpenLinksSetting.description',
        'PR, CI, ticket and list links from the band and the Panel. The system browser has your GitHub and Jira sign-ins.'
      )}
      control={
        <SettingsSegmentedControl
          value={value}
          ariaLabel={label}
          size="sm"
          options={[
            { value: 'orca' as const, label: labels.orca },
            { value: 'system' as const, label: labels.system }
          ]}
          onChange={onChange}
        />
      }
    />
  )
}

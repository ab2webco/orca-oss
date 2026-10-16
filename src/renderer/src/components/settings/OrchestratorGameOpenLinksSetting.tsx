import type { OrchestratorGameOpenLinks } from '../../../../shared/orchestrator-game-config'
import { SettingsRow, SettingsSegmentedControl } from './SettingsFormControls'
import { orchestratorGameInheritLabel } from './orchestrator-game-setting-labels'
import { translate } from '@/i18n/i18n'

export const orchestratorGameOpenLinksLabels = (): Record<OrchestratorGameOpenLinks, string> => ({
  orca: translate('auto.components.settings.OrchestratorGameOpenLinksSetting.orca', 'Orca'),
  system: translate(
    'auto.components.settings.OrchestratorGameOpenLinksSetting.system',
    'System browser'
  )
})

/** Where the game's links open; a project row also offers Inherit and says what it resolves to. */
export function OrchestratorGameOpenLinksRow<V extends OrchestratorGameOpenLinks | 'inherit'>({
  value,
  effective,
  disabled,
  onChange
}: {
  value: V
  /** The project's resolved choice and its source; set only on a project row. */
  effective?: string
  disabled?: boolean
  onChange: (next: V) => void
}): React.JSX.Element {
  const label = translate(
    'auto.components.settings.OrchestratorGameOpenLinksSetting.label',
    'Open links in'
  )
  const labels = orchestratorGameOpenLinksLabels()
  const options = [
    ...(effective === undefined
      ? []
      : [{ value: 'inherit' as V, label: orchestratorGameInheritLabel() }]),
    { value: 'orca' as V, label: labels.orca },
    { value: 'system' as V, label: labels.system }
  ]
  return (
    <SettingsRow
      label={label}
      description={
        effective ??
        translate(
          'auto.components.settings.OrchestratorGameOpenLinksSetting.description',
          'PR, CI, ticket and list links from the band and the Panel. The system browser has your GitHub and Jira sign-ins.'
        )
      }
      control={
        <SettingsSegmentedControl
          value={value}
          ariaLabel={label}
          size="sm"
          options={options.map((one) => ({ ...one, disabled }))}
          onChange={onChange}
        />
      }
    />
  )
}

import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  MEMORY_PRESSURE_THRESHOLD_CHOICES,
  resolveMemoryPressureWarningSettings
} from '../../../../shared/memory-pressure-settings'
import {
  SettingsRow,
  SettingsSegmentedControl,
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from './SettingsFormControls'
import { SearchableSetting } from './SearchableSetting'
import { getMemoryPressureWarningSearchEntries } from './memory-pressure-warning-search'
import { translate } from '@/i18n/i18n'

export const MEMORY_PRESSURE_SECTION_ID = 'memory-pressure-warning'

type MemoryPressureWarningSectionProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function MemoryPressureWarningSection({
  settings,
  updateSettings
}: MemoryPressureWarningSectionProps): React.JSX.Element {
  const { enabled, thresholdPercent } = resolveMemoryPressureWarningSettings(settings)
  const [entry] = getMemoryPressureWarningSearchEntries()
  const thresholdLabel = translate(
    'auto.components.settings.MemoryPressureWarningSection.thresholdLabel',
    'Warn below'
  )
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={translate(
          'auto.components.settings.MemoryPressureWarningSection.title',
          'Low Memory'
        )}
        description={translate(
          'auto.components.settings.MemoryPressureWarningSection.description',
          'Agents, MCP servers and builds running in terminals can exhaust memory. Orca never closes a terminal on its own.'
        )}
      />
      <div className="divide-y divide-border/40">
        <SearchableSetting {...entry} id={MEMORY_PRESSURE_SECTION_ID}>
          <SettingsSwitchRow
            label={entry.title}
            description={entry.description}
            checked={enabled}
            onChange={() => updateSettings({ memoryPressureWarningEnabled: !enabled })}
          />
          {enabled ? (
            <SettingsRow
              label={thresholdLabel}
              description={translate(
                'auto.components.settings.MemoryPressureWarningSection.thresholdDescription',
                'Show the warning when free memory falls under this share of physical memory. On macOS it also shows when the system reports memory pressure. Terminals on SSH hosts are not measured.'
              )}
              control={
                <SettingsSegmentedControl
                  value={thresholdPercent}
                  ariaLabel={thresholdLabel}
                  size="sm"
                  options={MEMORY_PRESSURE_THRESHOLD_CHOICES.map((choice) => ({
                    value: choice,
                    label: `${choice}%`
                  }))}
                  onChange={(next) =>
                    updateSettings({ memoryPressureWarningThresholdPercent: next })
                  }
                />
              }
            />
          ) : null}
        </SearchableSetting>
      </div>
    </section>
  )
}

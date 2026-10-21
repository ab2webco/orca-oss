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
          'Orca warns only while an agent runs in a local terminal: when the system reports memory pressure for two minutes, or when memory will run out within ten minutes at its current rate. Orca never closes a terminal on its own. Off by default.'
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
                'On Linux and Windows the warning also shows when free memory stays under this share for two minutes. On macOS the system pressure signal is used instead, because cached memory makes free memory look low. Terminals on SSH hosts are not measured.'
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

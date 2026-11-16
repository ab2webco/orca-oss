import type React from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  getSidebarActivityWindowHours,
  type SidebarActivityWindowHours
} from '../../../../shared/sidebar-activity-window'
import { translate } from '@/i18n/i18n'
import { SearchableSetting } from './SearchableSetting'
import { SettingsRow, SettingsSegmentedControl } from './SettingsFormControls'
import { getSidebarActivityWindowEntry } from './appearance-sidebar-search'

function windowOptions(): { value: SidebarActivityWindowHours; label: string }[] {
  return [
    {
      value: 12,
      label: translate('auto.components.settings.SidebarActivityWindowSetting.hours12', '12 h')
    },
    {
      value: 24,
      label: translate('auto.components.settings.SidebarActivityWindowSetting.hours24', '24 h')
    },
    {
      value: 72,
      label: translate('auto.components.settings.SidebarActivityWindowSetting.days3', '3 d')
    },
    {
      value: 168,
      label: translate('auto.components.settings.SidebarActivityWindowSetting.days7', '7 d')
    }
  ]
}

/** How long a project stays active before it folds into the sidebar's idle group (ORCA-1216). */
export function SidebarActivityWindowSetting({
  settings,
  updateSettings
}: {
  settings: Pick<GlobalSettings, 'sidebarActivityWindowHours'>
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element {
  const entry = getSidebarActivityWindowEntry()
  return (
    <SearchableSetting
      title={entry.title}
      description={entry.description}
      keywords={entry.keywords}
    >
      <SettingsRow
        label={entry.title}
        description={entry.description}
        control={
          <SettingsSegmentedControl
            ariaLabel={entry.title}
            value={getSidebarActivityWindowHours(settings)}
            onChange={(hours) => updateSettings({ sidebarActivityWindowHours: hours })}
            options={windowOptions()}
          />
        }
      />
    </SearchableSetting>
  )
}

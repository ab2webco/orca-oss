import type React from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSwitchRow } from './SettingsFormControls'
import { getMobileUpdateInstallSearchEntries } from './mobile-update-install-search'

type MobileUpdateInstallSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function MobileUpdateInstallSetting({
  settings,
  updateSettings
}: MobileUpdateInstallSettingProps): React.JSX.Element {
  const [entry] = getMobileUpdateInstallSearchEntries()
  const enabled = settings.allowMobileUpdateInstall === true

  return (
    <SearchableSetting {...entry}>
      <SettingsSwitchRow
        label={entry.title}
        description={entry.description}
        checked={enabled}
        onChange={() => updateSettings({ allowMobileUpdateInstall: !enabled })}
      />
    </SearchableSetting>
  )
}

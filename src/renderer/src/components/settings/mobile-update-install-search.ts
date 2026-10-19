import { translate } from '@/i18n/i18n'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import { translateSearchKeyword } from './settings-search-keywords'

export const getMobileUpdateInstallSearchEntries = createLocalizedCatalog(() => [
  {
    title: translate(
      'auto.components.settings.MobileUpdateInstallSetting.title',
      'Update from a paired phone'
    ),
    description: translate(
      'auto.components.settings.MobileUpdateInstallSetting.description',
      'Let a paired phone ask this computer to install the update Orca Lab already offers. A countdown you can cancel shows before Orca restarts, and requests are refused while agents are working.'
    ),
    keywords: [
      ...translateSearchKeyword(
        'auto.components.settings.MobileUpdateInstallSetting.kPhone',
        'phone'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.MobileUpdateInstallSetting.kMobile',
        'mobile'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.MobileUpdateInstallSetting.kUpdate',
        'update'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.MobileUpdateInstallSetting.kRestart',
        'restart'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.MobileUpdateInstallSetting.kRemote',
        'remote'
      )
    ]
  }
])

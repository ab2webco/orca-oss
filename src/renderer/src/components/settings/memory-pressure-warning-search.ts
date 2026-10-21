import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from './settings-search-keywords'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'

export const getMemoryPressureWarningSearchEntries = createLocalizedCatalog(() => [
  {
    title: translate(
      'auto.components.settings.terminal.search.memoryPressureTitle',
      'Low memory warning'
    ),
    description: translate(
      'auto.components.settings.terminal.search.memoryPressureDescription',
      'Warn when agents in terminals are about to run out of memory and name the terminals at risk.'
    ),
    keywords: [
      ...translateSearchKeyword('auto.components.settings.terminal.search.memoryKeyword', 'memory'),
      ...translateSearchKeyword('auto.components.settings.terminal.search.ramKeyword', 'ram'),
      ...translateSearchKeyword('auto.components.settings.terminal.search.swapKeyword', 'swap'),
      ...translateSearchKeyword(
        'auto.components.settings.terminal.search.pressureKeyword',
        'pressure'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.terminal.search.warningKeyword',
        'warning'
      )
    ]
  }
])

import { translate } from '@/i18n/i18n'
import type { NewTabAccountRow } from '../../../../shared/new-tab-account-choice'

export type NewTabAccountRowText = { detail: string; tag: string | null }

/** The account row's second line: why it is off, or what it is, or how much is used. */
export function newTabAccountRowTextOf(row: NewTabAccountRow): NewTabAccountRowText {
  const tag =
    row.inUseBy.length > 0
      ? translate('newTabMenu.account.inUseBy', 'In use by {{value}}', {
          value: row.inUseBy.join(', ')
        })
      : null
  return { detail: detailOf(row), tag }
}

function detailOf(row: NewTabAccountRow): string {
  if (row.disabled === 'limited') {
    return translate('newTabMenu.account.limited', 'Limit reached')
  }
  if (row.disabled === 'signed-out') {
    return translate('newTabMenu.account.signedOut', 'Signed out')
  }
  if (row.otherModel) {
    return translate('newTabMenu.account.otherModel', 'Other model')
  }
  if (row.usedPercent === null) {
    return translate('newTabMenu.account.noReading', 'No reading')
  }
  return translate('newTabMenu.account.used', '{{value}}% used', {
    value: Math.round(row.usedPercent)
  })
}

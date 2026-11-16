import { translate } from '@/i18n/i18n'

const MINUTE = 60_000

/** The sidebar's one short age (`now`, `4 min`, `5 h`, `3 d`, `1 wk`); null when there is no timestamp. */
export function formatShortActivityAge(since: number, now: number): string | null {
  if (!(since > 0)) {
    return null
  }
  const minutes = Math.floor((now - since) / MINUTE)
  if (minutes < 1) {
    return translate('auto.components.sidebar.ShortActivityAge.now', 'now')
  }
  if (minutes < 60) {
    return translate('auto.components.sidebar.ShortActivityAge.minutes', '{{count}} min', {
      count: minutes
    })
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return translate('auto.components.sidebar.ShortActivityAge.hours', '{{count}} h', {
      count: hours
    })
  }
  const days = Math.floor(hours / 24)
  if (days < 7) {
    return translate('auto.components.sidebar.ShortActivityAge.days', '{{count}} d', {
      count: days
    })
  }
  return translate('auto.components.sidebar.ShortActivityAge.weeks', '{{count}} wk', {
    count: Math.floor(days / 7)
  })
}

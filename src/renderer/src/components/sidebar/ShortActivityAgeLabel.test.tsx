// @vitest-environment happy-dom

import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { i18n } from '@/i18n/i18n'
import es from '@/i18n/locales/es.json'
import { ShortActivityAgeLabel } from './ShortActivityAgeLabel'

describe('ShortActivityAgeLabel', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('draws the short age of a timestamp', () => {
    const { container } = render(<ShortActivityAgeLabel since={Date.now() - 5 * 3_600_000} />)
    expect(container.querySelector('[data-activity-age]')?.textContent).toBe('5 h')
  })

  it('draws nothing for a workspace with no activity timestamp', () => {
    const { container } = render(<ShortActivityAgeLabel since={0} />)
    expect(container.querySelector('[data-activity-age]')).toBeNull()
    const { container: none } = render(<ShortActivityAgeLabel since={undefined} />)
    expect(none.querySelector('[data-activity-age]')).toBeNull()
  })

  // Why: a memo boundary whose props never change on a language switch kept 'now' beside 'ahora'.
  it('relabels itself when the UI language changes after mount', async () => {
    const { container } = render(<ShortActivityAgeLabel since={Date.now() - 1_000} />)
    expect(container.querySelector('[data-activity-age]')?.textContent).toBe('now')

    await act(async () => {
      await i18n.changeLanguage('es')
    })

    const localized = es.auto.components.sidebar.ShortActivityAge.now
    expect(localized).not.toBe('now')
    expect(container.querySelector('[data-activity-age]')?.textContent).toBe(localized)
  })
})

// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { getGeneralUpdateSearchEntries } from './general-search'
import { MobileUpdateInstallSetting } from './MobileUpdateInstallSetting'

let root: Root | null = null

function render(settings: Partial<GlobalSettings>, updateSettings = vi.fn()): HTMLDivElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root?.render(
      <MobileUpdateInstallSetting
        settings={settings as GlobalSettings}
        updateSettings={updateSettings}
      />
    )
  })
  return host
}

afterEach(() => {
  act(() => root?.unmount())
  document.body.innerHTML = ''
  root = null
})

describe('MobileUpdateInstallSetting', () => {
  it('is off for a profile that never set it', () => {
    const host = render({})

    expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false')
  })

  it('turns the opt-in on and off through the saved setting', () => {
    const updateSettings = vi.fn()
    const off = render({}, updateSettings)
    act(() => off.querySelector<HTMLButtonElement>('[role="switch"]')?.click())
    act(() => root?.unmount())
    document.body.innerHTML = ''

    const on = render({ allowMobileUpdateInstall: true }, updateSettings)
    expect(on.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true')
    act(() => on.querySelector<HTMLButtonElement>('[role="switch"]')?.click())

    expect(updateSettings.mock.calls).toEqual([
      [{ allowMobileUpdateInstall: true }],
      [{ allowMobileUpdateInstall: false }]
    ])
  })

  it('is found by searching for the phone', () => {
    const titles = getGeneralUpdateSearchEntries().map((entry) => entry.title)

    expect(titles).toContain('Update from a paired phone')
  })
})

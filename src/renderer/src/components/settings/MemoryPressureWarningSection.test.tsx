// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { MemoryPressureWarningSection } from './MemoryPressureWarningSection'
import { getTerminalPaneSearchEntries } from './terminal-search'

let root: Root | null = null

function render(settings: Partial<GlobalSettings>, updateSettings = vi.fn()): HTMLDivElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root?.render(
      <MemoryPressureWarningSection
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

describe('MemoryPressureWarningSection', () => {
  it('is on at 10% for a profile that never set it', () => {
    const host = render({})

    expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true')
    expect(host.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe('10%')
  })

  it('turns the warning off and picks a threshold', () => {
    const updateSettings = vi.fn()
    const host = render({}, updateSettings)

    act(() => host.querySelector<HTMLButtonElement>('[role="switch"]')?.click())
    const fifteen = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find(
      (radio) => radio.textContent === '15%'
    )
    act(() => fifteen?.click())

    expect(updateSettings.mock.calls).toEqual([
      [{ memoryPressureWarningEnabled: false }],
      [{ memoryPressureWarningThresholdPercent: 15 }]
    ])
  })

  it('hides the threshold while the warning is off', () => {
    const host = render({ memoryPressureWarningEnabled: false })

    expect(host.querySelector('[role="radio"]')).toBeNull()
  })

  it('is findable from Settings search', () => {
    const titles = getTerminalPaneSearchEntries({ isWindows: false, isMac: true }).map(
      (entry) => entry.title
    )

    expect(titles).toContain('Low memory warning')
  })
})

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
  it('is off with no threshold picker for a profile that never set it', () => {
    const host = render({})

    expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false')
    expect(host.querySelector('[role="radio"]')).toBeNull()
  })

  it('turns the warning on from the default', () => {
    const updateSettings = vi.fn()
    const host = render({}, updateSettings)

    act(() => host.querySelector<HTMLButtonElement>('[role="switch"]')?.click())

    expect(updateSettings.mock.calls).toEqual([[{ memoryPressureWarningEnabled: true }]])
  })

  it('shows the threshold at 10% once on, and turns it off again', () => {
    const updateSettings = vi.fn()
    const host = render({ memoryPressureWarningEnabled: true }, updateSettings)

    expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true')
    expect(host.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe('10%')
    const fifteen = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find(
      (radio) => radio.textContent === '15%'
    )
    act(() => fifteen?.click())
    act(() => host.querySelector<HTMLButtonElement>('[role="switch"]')?.click())

    expect(updateSettings.mock.calls).toEqual([
      [{ memoryPressureWarningThresholdPercent: 15 }],
      [{ memoryPressureWarningEnabled: false }]
    ])
  })

  it('hides the threshold while the warning is explicitly off', () => {
    const host = render({ memoryPressureWarningEnabled: false })

    expect(host.querySelector('[role="radio"]')).toBeNull()
  })

  it('says it is off by default', () => {
    expect(render({}).textContent).toContain('Off by default')
  })

  it('says in plain words what opens the warning', () => {
    const text = render({ memoryPressureWarningEnabled: true }).textContent ?? ''

    expect(text).toContain('only while an agent runs in a local terminal')
    expect(text).toContain('memory pressure for two minutes')
    expect(text).toContain('run out within ten minutes')
    expect(text).toContain('On macOS the system pressure signal is used instead')
  })

  it('is findable from Settings search', () => {
    const titles = getTerminalPaneSearchEntries({ isWindows: false, isMac: true }).map(
      (entry) => entry.title
    )

    expect(titles).toContain('Low memory warning')
  })
})

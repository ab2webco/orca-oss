// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { StatusColorsSetting } from './StatusColorsSetting'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, string>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => values?.[name] ?? '')
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  vi.useFakeTimers()
  document.documentElement.classList.add('dark')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  vi.useRealTimers()
  document.documentElement.classList.remove('dark')
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})

async function render(statusColors: GlobalSettings['statusColors']) {
  const updateSettings = vi.fn()
  await act(async () => {
    root.render(
      <StatusColorsSetting
        settings={{ theme: 'dark', statusColors } as GlobalSettings}
        updateSettings={updateSettings}
      />
    )
  })
  return updateSettings
}

function picker(name: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${name} color"]`)
  expect(input).not.toBeNull()
  return input!
}

async function pick(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('StatusColorsSetting', () => {
  it('shows the five tones with the current theme defaults', async () => {
    await render(undefined)

    expect(container.querySelectorAll('input[type="color"]')).toHaveLength(5)
    expect(picker('Working').value).toBe('#4fc3f7')
    expect(picker('Needs you').value).toBe('#ff6568')
  })

  it('paints a pick at once and persists it once the picker settles', async () => {
    const updateSettings = await render(undefined)

    await pick(picker('Working'), '#123456')
    expect(document.getElementById('orca-status-colors')?.textContent).toContain(
      '--status-info:#123456'
    )
    expect(updateSettings).not.toHaveBeenCalled()

    await act(async () => vi.advanceTimersByTime(300))
    expect(updateSettings).toHaveBeenCalledWith({ statusColors: { dark: { info: '#123456' } } })
  })

  it('follows the app theme when it changes while Settings is open', async () => {
    await render(undefined)
    expect(picker('Working').value).toBe('#4fc3f7')

    await act(async () => {
      root.render(
        <StatusColorsSetting
          settings={{ theme: 'light' } as GlobalSettings}
          updateSettings={vi.fn()}
        />
      )
    })

    expect(picker('Working').value).toBe('#0369a1')
  })

  it('warns when a tone gets too close to another', async () => {
    await render({ dark: { warning: '#ff6a6a' } })

    expect(container.textContent).toContain('Too close to Needs you')
  })

  it('resets only the theme being edited', async () => {
    const updateSettings = await render({
      dark: { info: '#123456' },
      light: { info: '#654321' }
    })

    const reset = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Reset status colors"]'
    )
    await act(async () => reset!.click())

    expect(updateSettings).toHaveBeenCalledWith({ statusColors: { light: { info: '#654321' } } })
  })
})

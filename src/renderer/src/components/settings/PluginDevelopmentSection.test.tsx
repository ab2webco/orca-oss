// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginDevelopmentSection } from './PluginDevelopmentSection'

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

function render(paths: string[], trustedPaths: string[]) {
  const onChange = vi.fn().mockResolvedValue(undefined)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() =>
    root!.render(
      <PluginDevelopmentSection
        paths={paths}
        trustedPaths={trustedPaths}
        busy={false}
        onChange={onChange}
      />
    )
  )
  return { container: host, onChange }
}

function trustToggles(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button[role="checkbox"]'))
}

describe('PluginDevelopmentSection folder trust', () => {
  it('offers an unticked trust toggle per folder and trusts only the one ticked', async () => {
    const { container, onChange } = render(['/plugins/a', '/plugins/b'], [])
    const toggles = trustToggles(container)

    expect(toggles.map((toggle) => toggle.getAttribute('aria-checked'))).toEqual(['false', 'false'])
    expect(toggles[1]!.getAttribute('aria-label')).toContain('/plugins/b')
    await act(async () => toggles[1]!.click())

    expect(onChange).toHaveBeenCalledWith({
      paths: ['/plugins/a', '/plugins/b'],
      trustedPaths: ['/plugins/b']
    })
  })

  it('stops trusting a folder when its toggle is cleared', async () => {
    const { container, onChange } = render(['/plugins/a'], ['/plugins/a'])
    const [toggle] = trustToggles(container)

    expect(toggle!.getAttribute('aria-checked')).toBe('true')
    await act(async () => toggle!.click())

    expect(onChange).toHaveBeenCalledWith({ paths: ['/plugins/a'], trustedPaths: [] })
  })

  it('drops the trust of a folder that is removed', async () => {
    const { container, onChange } = render(['/plugins/a', '/plugins/b'], ['/plugins/a'])
    const remove = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Remove'
    )

    await act(async () => remove!.click())

    expect(onChange).toHaveBeenCalledWith({ paths: ['/plugins/b'], trustedPaths: [] })
  })
})

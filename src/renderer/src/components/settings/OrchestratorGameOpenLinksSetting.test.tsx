// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { OrchestratorGameOpenLinksRow } from './OrchestratorGameOpenLinksSetting'

function render(element: React.JSX.Element): { container: HTMLDivElement; unmount: () => void } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(element))
  return {
    container,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    }
  }
}

function click(container: HTMLElement, label: string): void {
  const target = Array.from(
    container.querySelectorAll<HTMLElement>('[aria-label="Open links in"] button')
  ).find((entry) => entry.textContent?.trim() === label)
  expect(target, label).toBeTruthy()
  act(() => {
    target?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('OrchestratorGameOpenLinksRow', () => {
  it('picks Orca or the system browser for every project', () => {
    const picked: unknown[] = []
    const view = render(
      <OrchestratorGameOpenLinksRow value="orca" onChange={(next) => picked.push(next)} />
    )
    expect(view.container.textContent).toContain('Open links in')
    click(view.container, 'System browser')
    expect(picked).toEqual(['system'])
    view.unmount()
  })
})

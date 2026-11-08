// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TeamSceneBubbles } from './TeamSceneBubbles'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement

const render = (text: string): HTMLElement => {
  act(() =>
    root.render(
      <TeamSceneBubbles
        speeches={[{ key: 'lead', text, anchor: { x: 180, top: 120 } }]}
        width={360}
        height={176}
        cloudPixel={3}
      />
    )
  )
  return host.querySelector<HTMLElement>('[data-scene-bubble="lead"]')!
}

beforeEach(() => {
  // happy-dom has no layout: offsetWidth stands for a line measured at 119.5 to 120.5 px.
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(120)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(41)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

describe('TeamSceneBubbles', () => {
  // ORCA-1139: a cloud laid half a pixel short wrapped `cat TeamSceneBubbles.tsx` onto a second
  // line the one-line cloud did not hold.
  it('lays a bubble at least as wide as the line it measured', () => {
    const bubble = render('cat TeamSceneBubbles.tsx')
    expect(Number.parseFloat(bubble.style.width)).toBeGreaterThanOrEqual(120.5)
  })

  it('keeps its laid width when a new layout lands on the same width', () => {
    const first = render('cat TeamSceneBubbles.tsx').style.width
    const again = render('cat TeamScenePixelCloud.tsx').style.width
    expect(again).toMatch(/px$/)
    expect(again).toBe(first)
  })
})

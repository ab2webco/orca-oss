// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TeamSceneBubbles } from './TeamSceneBubbles'
import type { TeamSceneRect } from './team-scene-bubble-layout'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement

const render = (text: string, obstacles?: TeamSceneRect[]): HTMLElement => {
  act(() =>
    root.render(
      <TeamSceneBubbles
        speeches={[{ key: 'lead', text, anchor: { x: 180, top: 120 } }]}
        width={360}
        height={176}
        cloudPixel={3}
        obstacles={obstacles}
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
  // hallmark sloplint: colour through tokens, a solid surface, a decorative canvas hidden.
  it('draws both bubbles from tokens on a solid surface, its cloud canvas hidden from readers', () => {
    const cloud = render('Merge #923?')
    expect(cloud.querySelector('canvas')?.getAttribute('aria-hidden')).toBe('true')
    const cloudClass = cloud.className
    act(() =>
      root.render(
        <TeamSceneBubbles
          speeches={[{ key: 'lead', text: 'Merge #923?', anchor: { x: 180, top: 120 } }]}
          width={360}
          height={176}
        />
      )
    )
    const glass = host.querySelector<HTMLElement>('[data-scene-bubble="lead"]')!
    for (const bubble of [cloudClass, glass.className]) {
      expect(bubble).not.toMatch(/#[0-9a-f]{3,8}/i)
      expect(bubble).not.toContain('backdrop-blur')
    }
  })

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

  // ORCA-1139 criterion 8: the bubble sat over the asking member's tag.
  it('lays its bubble clear of an obstacle it is given', () => {
    const free = Number.parseFloat(render('exec_command').style.top)
    const tag = { left: 100, top: free + 10, width: 60, height: 18 }
    const bubble = render('exec_command', [tag])
    expect(Number.parseFloat(bubble.style.top) + 41).toBeLessThanOrEqual(tag.top)
  })

  // Lead decision A: on Pixel's 219 px stage a member's tag leaves room for the lead's bubble only.
  it("hides the advisor's bubble while a tag needs its room, and shows it again once the tag goes", () => {
    const shown = (obstacles: TeamSceneRect[]) => {
      act(() =>
        root.render(
          <TeamSceneBubbles
            speeches={[
              {
                key: 'advisor',
                text: 'Keep this one small',
                anchor: { x: 162, top: 81 },
                align: 'end',
                yields: true
              },
              { key: 'lead', text: 'exec_command', anchor: { x: 184, top: 84 } }
            ]}
            width={219}
            height={126}
            cloudPixel={3}
            obstacles={obstacles}
          />
        )
      )
      return [...host.querySelectorAll<HTMLElement>('[data-scene-bubble]')]
        .filter((one) => one.style.visibility === 'visible')
        .map((one) => one.dataset.sceneBubble)
    }
    expect(shown([{ left: 4, top: 46, width: 58, height: 18 }])).toEqual(['lead'])
    expect(shown([])).toEqual(['advisor', 'lead'])
  })

  // Why: Pixel's two-line cloud has no room by an asker's tag on a narrow stage (run 42985493201).
  it("clamps an attending lead's line to one when two find no spot, and keeps it shown", () => {
    // Two lines measure 53 px tall; on one line (nowrap) the same text is 41 px.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
      function (this: HTMLElement) {
        return this.style.whiteSpace === 'nowrap' ? 41 : 53
      }
    )
    const tag = { left: 4, top: 46, width: 56, height: 18 }
    const speech = {
      key: 'lead',
      text: 'Waiting for you Merge #12 now?',
      anchor: { x: 38, top: 84 }
    }
    const unplaced = vi.fn()
    const show = (attending: boolean): HTMLElement => {
      act(() =>
        root.render(
          <TeamSceneBubbles
            onUnplaced={unplaced}
            speeches={[{ ...speech, attending }]}
            width={219}
            height={176}
            cloudPixel={3}
            obstacles={[tag]}
          />
        )
      )
      return host.querySelector<HTMLElement>('[data-scene-bubble="lead"]')!
    }
    expect(show(false).style.visibility).toBe('hidden')
    const bubble = show(true)
    expect(bubble.style.visibility).toBe('visible')
    expect(bubble.querySelector('.line-clamp-1')?.textContent).toBe(speech.text)
    // Clamped, the line is not whole in its bubble, so its card shows it all as for an unplaced one.
    expect(unplaced).toHaveBeenLastCalledWith(['lead'])
  })
})

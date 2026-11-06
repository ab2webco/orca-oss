// @vitest-environment happy-dom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TeamSceneInput } from '../../../../shared/team-scene/team-scene-types'
import { TeamSceneCanvas } from './TeamSceneCanvas'
import type { TeamSceneFrame, TeamScenePainter } from './team-scene-painter'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const lead = { key: 'lead', name: 'Lead', characterKey: null, activity: 'working' } as const
const member = (key: string) =>
  ({
    key,
    name: key,
    characterKey: null,
    activity: 'working',
    reportId: null,
    mergedPr: null
  }) as const
const input = (keys: string[], advisorLine?: string): TeamSceneInput => ({
  lead,
  advisor: advisorLine === undefined ? null : { line: advisorLine },
  members: keys.map(member)
})

function painter() {
  const frames: TeamSceneFrame[] = []
  const value: TeamScenePainter = {
    height: 176,
    headTop: () => 100,
    paint: (_g, frame) => frames.push(frame),
    dispose: vi.fn()
  }
  return { value, frames }
}

let root: Root
let host: HTMLDivElement
let hidden = false
let reduced = false

const render = (node: React.ReactElement): void => {
  act(() => root.render(node))
}

beforeEach(() => {
  hidden = false
  reduced = false
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() =>
    hidden ? 'hidden' : 'visible'
  )
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query) =>
      ({
        matches: reduced,
        media: query,
        addEventListener() {},
        removeEventListener() {}
      }) as unknown as MediaQueryList
  )
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(360)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    setTransform() {},
    clearRect() {},
    fillRect() {}
  } as unknown as CanvasRenderingContext2D)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

describe('TeamSceneCanvas', () => {
  it('draws an image labelled for screen readers', () => {
    render(
      <TeamSceneCanvas
        input={input([])}
        painter={painter().value}
        label="Live team scene"
        leadLine={null}
      />
    )
    const canvas = host.querySelector('canvas')!
    expect(canvas.getAttribute('role')).toBe('img')
    expect(canvas.getAttribute('aria-label')).toBe('Live team scene')
  })

  it('animates only while the window is visible', () => {
    hidden = true
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)
    render(
      <TeamSceneCanvas
        input={input(['a'])}
        painter={painter().value}
        label="scene"
        leadLine={null}
      />
    )
    expect(raf).not.toHaveBeenCalled()
    hidden = false
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(raf).toHaveBeenCalled()
  })

  it('paints the settled end state once per change under reduced motion', () => {
    reduced = true
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)
    const p = painter()
    render(<TeamSceneCanvas input={input(['a'])} painter={p.value} label="scene" leadLine={null} />)
    render(
      <TeamSceneCanvas input={input(['a', 'n'])} painter={p.value} label="scene" leadLine={null} />
    )
    expect(raf).not.toHaveBeenCalled()
    expect(p.frames).toHaveLength(2)
    const newcomer = p.frames[1].actors.find((a) => a.key === 'n')!
    // Seated on stage, not queued off it at x < 0.
    expect(newcomer.pose).toBe('work')
    expect(newcomer.x).toBeGreaterThan(0)
  })

  it('ties the lead line to the lead', () => {
    reduced = true
    render(
      <TeamSceneCanvas
        input={input(['a'])}
        painter={painter().value}
        label="scene"
        leadLine="Reviewing #923"
      />
    )
    act(() => {})
    expect(host.querySelector('[data-scene-bubble="lead"]')?.textContent).toBe('Reviewing #923')
  })

  it("draws Pixel's thought cloud instead of the glass bubble", () => {
    reduced = true
    // happy-dom has no layout; a measured bubble is what lets the layout place it.
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(120)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(30)
    const cloudy = { ...painter().value, cloudPixel: 3 }
    render(
      <TeamSceneCanvas input={input(['a'])} painter={cloudy} label="scene" leadLine="Merge?" />
    )
    const bubble = host.querySelector('[data-scene-bubble="lead"]')!
    expect(bubble.querySelector('canvas')).not.toBeNull()
    expect(bubble.className).toContain('font-mono')
    render(
      <TeamSceneCanvas
        input={input(['a'])}
        painter={painter().value}
        label="scene"
        leadLine="Merge?"
      />
    )
    expect(host.querySelector('[data-scene-bubble="lead"] canvas')).toBeNull()
  })

  it('fades the advisor line after six seconds even without frames', () => {
    vi.useFakeTimers()
    reduced = true
    const p = painter()
    render(
      <TeamSceneCanvas input={input([], 'first')} painter={p.value} label="scene" leadLine={null} />
    )
    render(
      <TeamSceneCanvas
        input={input([], 'Raised effort')}
        painter={p.value}
        label="scene"
        leadLine={null}
      />
    )
    expect(host.querySelector('[data-scene-bubble="advisor"]')?.textContent).toBe('Raised effort')
    act(() => vi.advanceTimersByTime(5900))
    expect(host.querySelector('[data-scene-bubble="advisor"]')).not.toBeNull()
    act(() => vi.advanceTimersByTime(200))
    expect(host.querySelector('[data-scene-bubble="advisor"]')).toBeNull()
    vi.useRealTimers()
  })

  it('releases the canvas, the frame and the painter on close', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(7)
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    const p = painter()
    render(<TeamSceneCanvas input={input(['a'])} painter={p.value} label="scene" leadLine={null} />)
    const canvas = host.querySelector('canvas')!
    act(() => root.unmount())
    expect(cancel).toHaveBeenCalledWith(7)
    expect(p.value.dispose).toHaveBeenCalled()
    expect([canvas.width, canvas.height]).toEqual([0, 0])
    root = createRoot(host)
  })
})

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
const input = (keys: string[]): TeamSceneInput => ({
  lead,
  advisor: null,
  members: keys.map(member)
})

function painter() {
  const frames: TeamSceneFrame[] = []
  const value: TeamScenePainter = {
    height: 176,
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
    setTransform() {}
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
    render(<TeamSceneCanvas input={input([])} painter={painter().value} label="Live team scene" />)
    const canvas = host.querySelector('canvas')!
    expect(canvas.getAttribute('role')).toBe('img')
    expect(canvas.getAttribute('aria-label')).toBe('Live team scene')
  })

  it('animates only while the window is visible', () => {
    hidden = true
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)
    render(<TeamSceneCanvas input={input(['a'])} painter={painter().value} label="scene" />)
    expect(raf).not.toHaveBeenCalled()
    hidden = false
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(raf).toHaveBeenCalled()
  })

  it('paints the settled end state once per change under reduced motion', () => {
    reduced = true
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)
    const p = painter()
    render(<TeamSceneCanvas input={input(['a'])} painter={p.value} label="scene" />)
    render(<TeamSceneCanvas input={input(['a', 'n'])} painter={p.value} label="scene" />)
    expect(raf).not.toHaveBeenCalled()
    expect(p.frames).toHaveLength(2)
    const newcomer = p.frames[1].actors.find((a) => a.key === 'n')!
    // Seated on stage, not queued off it at x < 0.
    expect(newcomer.pose).toBe('work')
    expect(newcomer.x).toBeGreaterThan(0)
  })

  it('releases the canvas, the frame and the painter on close', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(7)
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    const p = painter()
    render(<TeamSceneCanvas input={input(['a'])} painter={p.value} label="scene" />)
    const canvas = host.querySelector('canvas')!
    act(() => root.unmount())
    expect(cancel).toHaveBeenCalledWith(7)
    expect(p.value.dispose).toHaveBeenCalled()
    expect([canvas.width, canvas.height]).toEqual([0, 0])
    root = createRoot(host)
  })
})

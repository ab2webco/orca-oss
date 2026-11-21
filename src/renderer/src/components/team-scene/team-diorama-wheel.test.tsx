// @vitest-environment happy-dom

import React, { useRef } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useDioramaCameraInput } from './use-diorama-camera-input'
import { DIORAMA_ZOOM, dioramaView, type DioramaView } from './team-diorama-view'
import { dioramaWheel } from './team-diorama-wheel'

const wheel = (deltaY: number, over: Partial<WheelEvent> = {}) => ({
  deltaX: 0,
  deltaY,
  deltaMode: 0,
  ctrlKey: false,
  metaKey: false,
  ...over
})

afterEach(cleanup)

describe('the wheel over a 3D scene', () => {
  it('zooms on a plain wheel: up is closer, down is farther', () => {
    const view = dioramaView()
    expect(dioramaWheel(view, wheel(-100), 0, { zoomingUntil: 0 })).toBe(true)
    expect(view.mode).toBe('free')
    expect(view.goalZoom).toBeGreaterThan(1)
    const closer = view.goalZoom
    expect(dioramaWheel(view, wheel(100), 1000, { zoomingUntil: 0 })).toBe(true)
    expect(view.goalZoom).toBeLessThan(closer)
  })

  it('hands a new gesture past the limit back to the panel, and keeps a zooming one', () => {
    const view = dioramaView()
    const gesture = { zoomingUntil: 0 }
    // A long scroll down: the zoom reaches its floor while the fingers still move.
    for (let t = 0; t < 2000; t += 16) {
      expect(dioramaWheel(view, wheel(40), t, gesture)).toBe(true)
    }
    expect(view.goalZoom).toBeCloseTo(DIORAMA_ZOOM.min)
    // Its inertial tail stays with the scene, so the panel does not jump.
    expect(dioramaWheel(view, wheel(8), 2100, gesture)).toBe(true)
    // A new scroll down after a pause scrolls the panel; up still zooms in.
    expect(dioramaWheel(view, wheel(40), 3000, gesture)).toBe(false)
    expect(dioramaWheel(view, wheel(-40), 4000, gesture)).toBe(true)
    expect(view.goalZoom).toBeGreaterThan(DIORAMA_ZOOM.min)
  })

  it('leaves a sideways scroll to the panel, and a pinch never scrolls it', () => {
    const view: DioramaView = { ...dioramaView(), mode: 'free', goalZoom: DIORAMA_ZOOM.max }
    expect(dioramaWheel(view, wheel(2, { deltaX: 60 }), 0, { zoomingUntil: 0 })).toBe(false)
    expect(dioramaWheel(view, wheel(-60, { ctrlKey: true }), 0, { zoomingUntil: 0 })).toBe(true)
    expect(view.goalZoom).toBe(DIORAMA_ZOOM.max)
  })

  it('stops the page from scrolling while it zooms, and lets it scroll at the limit', () => {
    let camera: DioramaView | null = null
    function Scene(): React.JSX.Element {
      const canvas = useRef<HTMLCanvasElement>(null)
      const redraw = useRef<(() => void) | null>(null)
      camera = useDioramaCameraInput(canvas, redraw).view.current
      return <canvas ref={canvas} />
    }
    const { container } = render(<Scene />)
    const canvas = container.querySelector('canvas')!
    const send = (deltaY: number) => {
      const e = new WheelEvent('wheel', { deltaY, cancelable: true, bubbles: true })
      canvas.dispatchEvent(e)
      return e.defaultPrevented
    }
    expect(send(-100)).toBe(true)
    expect(camera!.goalZoom).toBeGreaterThan(1)
    camera!.goalZoom = DIORAMA_ZOOM.max
    // Past the gesture's window, a further wheel in at the limit is the panel's.
    camera!.mode = 'free'
    const later = new WheelEvent('wheel', { deltaY: -100, cancelable: true, bubbles: true })
    Object.defineProperty(later, 'timeStamp', { value: 1e9 })
    canvas.dispatchEvent(later)
    expect(later.defaultPrevented).toBe(false)
  })
})

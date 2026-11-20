import { useEffect, useRef, useState, type RefObject } from 'react'
import {
  dioramaPan,
  dioramaView,
  dioramaZoomBy,
  type DioramaCameraMode,
  type DioramaView
} from './team-diorama-view'

/**
 * The diorama's camera and what moves it: a drag pans, a pinch (or Ctrl or ⌘ with the wheel, as a
 * trackpad pinch arrives) zooms, and either hands the camera to the viewer. A plain wheel still
 * scrolls the panel. `redraw` paints a frame when nothing else is animating, as under reduced motion.
 */
export function useDioramaCameraInput(
  canvas: RefObject<HTMLCanvasElement | null>,
  redraw: RefObject<(() => void) | null>
): {
  view: RefObject<DioramaView>
  mode: DioramaCameraMode
  setMode: (m: DioramaCameraMode) => void
} {
  const view = useRef<DioramaView>(dioramaView())
  const [mode, setModeState] = useState<DioramaCameraMode>('lead')
  const setMode = (next: DioramaCameraMode) => {
    view.current.mode = next
    setModeState(next)
    redraw.current?.()
  }
  useEffect(() => {
    const el = canvas.current
    if (!el) {
      return
    }
    const pointers = new Map<number, [number, number]>()
    let pinch: number | null = null
    const moved = () => {
      setModeState(view.current.mode)
      redraw.current?.()
    }
    const down = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId)
      pointers.set(e.pointerId, [e.clientX, e.clientY])
      el.style.cursor = 'grabbing'
    }
    const move = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId)
      if (!prev) {
        return
      }
      pointers.set(e.pointerId, [e.clientX, e.clientY])
      if (pointers.size === 1) {
        const dx = e.clientX - prev[0]
        const dy = e.clientY - prev[1]
        if (Math.abs(dx) + Math.abs(dy) >= 0.5) {
          dioramaPan(view.current, dx, dy)
          moved()
        }
        return
      }
      const [a, b] = [...pointers.values()]
      const d = Math.hypot(a![0] - b![0], a![1] - b![1])
      if (pinch) {
        dioramaZoomBy(view.current, d / pinch)
        moved()
      }
      pinch = d
    }
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId)
      pinch = null
      if (pointers.size === 0) {
        el.style.cursor = 'grab'
      }
    }
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) {
        return
      }
      e.preventDefault()
      dioramaZoomBy(view.current, Math.exp(-e.deltaY * 0.0015))
      moved()
    }
    el.style.cursor = 'grab'
    el.style.touchAction = 'none'
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('wheel', wheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('wheel', wheel)
    }
  }, [canvas, redraw])
  return { view, mode, setMode }
}

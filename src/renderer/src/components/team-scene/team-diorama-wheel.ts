import { DIORAMA_ZOOM, dioramaZoomBy, type DioramaView } from './team-diorama-view'

// Why a gesture window: a trackpad keeps sending inertial wheel events after the fingers lift, and
// a zoom that reached its limit must not hand that tail to the panel as a sudden scroll.
const GESTURE_GAP_MS = 250
const RATE = 0.0015

/** When the current wheel gesture last zoomed, so its inertial tail stays with the camera. */
export type DioramaWheelGesture = { zoomingUntil: number }

type Wheel = Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode' | 'ctrlKey' | 'metaKey'>

/**
 * One wheel event over the scene: a plain wheel or trackpad scroll zooms, as a pinch (Ctrl or ⌘
 * with the wheel) does. True when the scene took it; false hands it back so the panel scrolls: a
 * sideways scroll, or a new gesture past the zoom's limit.
 */
export function dioramaWheel(
  view: DioramaView,
  e: Wheel,
  now: number,
  gesture: DioramaWheelGesture
): boolean {
  const pinch = e.ctrlKey || e.metaKey
  const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1)
  if (!pinch && Math.abs(e.deltaX) > Math.abs(dy)) {
    return false
  }
  const zoom = view.mode === 'free' ? view.goalZoom : view.zoom
  const atLimit =
    dy < 0 ? zoom >= DIORAMA_ZOOM.max - 1e-6 : dy > 0 ? zoom <= DIORAMA_ZOOM.min + 1e-6 : true
  if (!pinch && atLimit && now >= gesture.zoomingUntil) {
    return false
  }
  gesture.zoomingUntil = now + GESTURE_GAP_MS
  if (!atLimit) {
    dioramaZoomBy(view, Math.exp(-dy * RATE))
  }
  return true
}

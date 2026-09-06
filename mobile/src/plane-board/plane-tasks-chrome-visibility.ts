import type { PlaneViewMode } from './plane-work-item-view'

type PlaneTasksChromeInput = {
  provider: string
  planeSupported: boolean
  taskUiReady: boolean
  viewMode: PlaneViewMode
}

export type PlaneTasksChrome = {
  /** The Plane chips in the Tasks segment row, the List/Board toggle among them. */
  segmentRowShown: boolean
  /** True suppresses the Tasks screen's own list rows; false draws them. */
  boardShown: boolean
  surfaceEnabled: boolean
}

/** The one answer to "which Plane UI is on screen".
 *
 *  The relay connection is deliberately not an input: it gates Plane's data, never its
 *  chrome. Gating the toggle on it hid the only way back to the list at the moment the
 *  board had nothing to show (ORCA-419). */
export function resolvePlaneTasksChrome({
  provider,
  planeSupported,
  taskUiReady,
  viewMode
}: PlaneTasksChromeInput): PlaneTasksChrome {
  const available = provider === 'plane' && planeSupported
  return {
    segmentRowShown: available,
    boardShown: taskUiReady && available && viewMode === 'board',
    surfaceEnabled: taskUiReady && available
  }
}

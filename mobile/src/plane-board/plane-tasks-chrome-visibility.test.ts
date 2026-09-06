import { describe, expect, it } from 'vitest'
import { resolvePlaneTasksChrome } from './plane-tasks-chrome-visibility'

const READY = { provider: 'plane', planeSupported: true, taskUiReady: true } as const

describe('which Plane UI the Tasks screen shows', () => {
  it('keeps the segment row — the List/Board toggle with it — on a host that can serve Plane', () => {
    expect(resolvePlaneTasksChrome({ ...READY, viewMode: 'board' }).segmentRowShown).toBe(true)
    expect(resolvePlaneTasksChrome({ ...READY, viewMode: 'list' }).segmentRowShown).toBe(true)
  })

  it('suppresses the screen list rows only while the board is the chosen view', () => {
    expect(resolvePlaneTasksChrome({ ...READY, viewMode: 'board' }).boardShown).toBe(true)
    expect(resolvePlaneTasksChrome({ ...READY, viewMode: 'list' }).boardShown).toBe(false)
  })

  it('shows nothing Plane-specific under another provider or an unsupported host', () => {
    const other = resolvePlaneTasksChrome({ ...READY, provider: 'linear', viewMode: 'board' })
    expect(other).toEqual({ segmentRowShown: false, boardShown: false, surfaceEnabled: false })
    const unsupported = resolvePlaneTasksChrome({
      ...READY,
      planeSupported: false,
      viewMode: 'board'
    })
    expect(unsupported).toEqual({
      segmentRowShown: false,
      boardShown: false,
      surfaceEnabled: false
    })
  })

  it('holds the board and the surface back until the task UI is ready, but not the row', () => {
    const hydrating = resolvePlaneTasksChrome({ ...READY, taskUiReady: false, viewMode: 'board' })
    expect(hydrating).toEqual({
      segmentRowShown: true,
      boardShown: false,
      surfaceEnabled: false
    })
  })
})

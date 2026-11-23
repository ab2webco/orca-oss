// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TeamPanelGameModel } from '../../../../shared/team-panel-model-types'
import { OFFICE3D_HEIGHT_KEY, office3dDefaultHeight } from './team-office3d-height'
import { office3dStage } from './team-office3d-stage'
import { TeamSceneOffice3d } from './TeamSceneOffice3d'

let machines = 1
vi.mock('../../../../shared/team-scene/team-office3d-layout', () => ({
  teamOffice3dLayoutOf: () => ({
    floors: [{ lobby: true }, ...Array.from({ length: machines }, () => ({}))],
    order: {}
  })
}))
vi.mock('../../../../shared/team-scene/team-scene-floors', () => ({ teamSceneFloorsOf: () => [] }))
vi.mock('../../../../shared/team-scene/team-scene-input', () => ({
  teamSceneInputOf: () => ({ members: [] })
}))
vi.mock('../../../../shared/team-scene/team-office3d-traffic', () => ({
  office3dTraffic: () => ({ members: new Map() }),
  office3dTrafficRead: () => {}
}))
vi.mock('./team-diorama-stage', () => ({ dioramaRenderer: () => ({ dispose: () => {} }) }))
// The full fit at this width: the most the handle can open the building to.
const FULL = 456
vi.mock('./team-office3d-stage', () => ({
  office3dStage: vi.fn((_r: unknown, args: { height: number }) => ({
    height: args.height,
    full: FULL,
    draw: () => {},
    pick: () => null,
    light: () => {},
    dispose: () => {}
  }))
}))

const heights = () => vi.mocked(office3dStage).mock.calls.map(([, a]) => a.height)
const drawn = () =>
  render(<TeamSceneOffice3d model={{} as TeamPanelGameModel} onNoWebgl={() => {}} />)

beforeEach(() => {
  window.localStorage.clear()
  vi.mocked(office3dStage).mockClear()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 280
  })
})
afterEach(cleanup)

describe('the 3D Office height', () => {
  it("opens at the 2D Office's height: one stage, or three floors' strips at most", () => {
    expect([1, 2, 3, 5].map(office3dDefaultHeight)).toEqual([176, 224, 336, 336])
    for (const n of [1, 2, 3]) {
      machines = n
      vi.mocked(office3dStage).mockClear()
      cleanup()
      drawn()
      expect(heights().at(-1)).toBe(office3dDefaultHeight(n))
    }
  })

  it('grows by dragging its bottom edge up to the full building, kept on this machine', () => {
    machines = 2
    const { getByRole } = drawn()
    const handle = getByRole('separator')
    expect(handle.getAttribute('aria-valuemax')).toBe(String(FULL))
    act(() => {
      fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1 })
      fireEvent.pointerMove(handle, { clientY: 200, pointerId: 1 })
      fireEvent.pointerUp(handle, { pointerId: 1 })
    })
    expect(heights().at(-1)).toBe(324)
    expect(window.localStorage.getItem(OFFICE3D_HEIGHT_KEY)).toBe('324')
    // The 2D building's height is its own.
    expect(window.localStorage.getItem('orca.teamBuilding.height')).toBeNull()
    cleanup()
    drawn()
    expect(heights().at(-1)).toBe(324)
  })

  it('never opens past the full building, and a double click goes back to the default', () => {
    machines = 1
    window.localStorage.setItem(OFFICE3D_HEIGHT_KEY, '9000')
    const { getByRole } = drawn()
    expect(heights().at(-1)).toBe(FULL)
    act(() => {
      fireEvent.doubleClick(getByRole('separator'))
    })
    expect(heights().at(-1)).toBe(176)
    expect(window.localStorage.getItem(OFFICE3D_HEIGHT_KEY)).toBe('')
  })
})

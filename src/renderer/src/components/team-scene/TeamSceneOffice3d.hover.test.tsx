// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TeamPanelGameModel } from '../../../../shared/team-panel-model-types'
import { useTeamSceneHover } from './team-scene-hit'
import { TeamSceneOffice3d } from './TeamSceneOffice3d'

vi.mock('../../../../shared/team-scene/team-office3d-layout', () => ({
  teamOffice3dLayoutOf: () => ({ floors: [], order: {} })
}))
vi.mock('../../../../shared/team-scene/team-office3d-traffic', () => ({
  office3dTraffic: () => ({ members: new Map() }),
  office3dTrafficRead: () => {}
}))
vi.mock('../../../../shared/team-scene/team-scene-floors', () => ({ teamSceneFloorsOf: () => [] }))
vi.mock('../../../../shared/team-scene/team-scene-input', () => ({
  teamSceneInputOf: () => ({ members: [], advisor: null })
}))
const stage = {
  height: 220,
  full: 220,
  draw: vi.fn(),
  dispose: vi.fn(),
  pick: vi.fn((): string | null => null),
  light: vi.fn()
}
vi.mock('./team-diorama-stage', () => ({ dioramaRenderer: () => ({ dispose: () => {} }) }))
vi.mock('./team-office3d-stage', () => ({ office3dStage: vi.fn(() => stage) }))

const open = vi.fn()
const members = new Map([['a', { open }]]) as unknown as Parameters<
  typeof TeamSceneOffice3d
>[0]['members']

const setReducedMotion = (reduce: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: reduce && q.includes('reduce'),
    addEventListener() {},
    removeEventListener() {}
  }))
const canvasOf = (container: HTMLElement) => container.querySelector('canvas')!
const office = () => (
  <TeamSceneOffice3d model={{} as TeamPanelGameModel} onNoWebgl={() => {}} members={members} />
)

beforeEach(() => {
  setReducedMotion(false)
  for (const fn of [stage.draw, stage.light, stage.pick, open]) {
    fn.mockClear()
  }
  for (const name of ['ResizeObserver', 'IntersectionObserver']) {
    vi.stubGlobal(
      name,
      class {
        observe() {}
        disconnect() {}
      }
    )
  }
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 280
  })
})
afterEach(() => {
  cleanup()
  useTeamSceneHover.getState().set(null)
  vi.unstubAllGlobals()
})

describe('the Office 3D wiring', () => {
  it('lights the figure of a row the Team list hovers, and clears it when the row lets go', () => {
    const { container } = render(office())
    expect(stage.light).toHaveBeenLastCalledWith(null)
    act(() => useTeamSceneHover.getState().set('a'))
    expect(stage.light).toHaveBeenLastCalledWith('a')
    expect(canvasOf(container).dataset.office3dLit).toBe('a')
    act(() => useTeamSceneHover.getState().set(null))
    expect(stage.light).toHaveBeenLastCalledWith(null)
    expect(canvasOf(container).dataset.office3dLit).toBe('')
  })

  it('lights the row of the figure under the pointer, and opens it on a click', () => {
    stage.pick.mockReturnValue('a')
    const { container } = render(office())
    const el = canvasOf(container)
    fireEvent.pointerMove(el, { clientX: 60, clientY: 50, pointerType: 'mouse', buttons: 0 })
    expect(useTeamSceneHover.getState().key).toBe('a')
    fireEvent.pointerDown(el, { clientX: 60, clientY: 50, pointerType: 'mouse' })
    fireEvent.click(el, { clientX: 61, clientY: 50 })
    expect(open).toHaveBeenCalledTimes(1)
    stage.pick.mockReturnValue(null)
  })

  it('redraws under reduced motion when a row lights its figure, so the ring shows', () => {
    setReducedMotion(true)
    render(office())
    stage.draw.mockClear()
    act(() => useTeamSceneHover.getState().set('a'))
    expect(stage.draw).toHaveBeenCalledWith(1.3)
  })
})

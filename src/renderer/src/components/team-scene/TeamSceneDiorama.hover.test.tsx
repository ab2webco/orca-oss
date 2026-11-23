// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TeamPanelGameModel } from '../../../../shared/team-panel-model-types'
import { useTeamSceneHover } from './team-scene-hit'
import { dioramaStage } from './team-diorama-stage'
import { TeamSceneDiorama } from './TeamSceneDiorama'

vi.mock('../../../../shared/team-scene/team-diorama-layout', () => ({
  teamDioramaLayoutOf: () => ({ islands: [], order: {} }),
  teamDioramaMachinesOf: () => []
}))
vi.mock('../../../../shared/team-scene/team-scene-floors', () => ({ teamSceneFloorsOf: () => [] }))
vi.mock('../../../../shared/team-scene/team-scene-input', () => ({
  teamSceneInputOf: () => ({ members: [], advisor: null })
}))
vi.mock('./team-diorama-read', () => ({
  dioramaCuesAfter: () => [],
  dioramaMoments: () => ({}),
  dioramaViewsOf: () => new Map()
}))
const stage = {
  height: 220,
  fitted: 220,
  draw: vi.fn(),
  dispose: vi.fn(),
  pick: vi.fn((): string | null => null),
  light: vi.fn()
}
vi.mock('./team-diorama-stage', () => ({
  dioramaRenderer: () => ({ dispose: () => {} }),
  dioramaStage: vi.fn(() => stage)
}))

const open = vi.fn()
const members = new Map([['a', { open }]]) as unknown as Parameters<
  typeof TeamSceneDiorama
>[0]['members']

const setReducedMotion = (reduce: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: reduce && q.includes('reduce'),
    addEventListener() {},
    removeEventListener() {}
  }))
const canvasOf = (container: HTMLElement) => container.querySelector('canvas')!

beforeEach(() => {
  setReducedMotion(false)
  vi.mocked(dioramaStage).mockClear()
  for (const fn of [stage.draw, stage.light, stage.pick, open]) {
    fn.mockClear()
  }
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
afterEach(() => {
  cleanup()
  useTeamSceneHover.getState().set(null)
  vi.unstubAllGlobals()
})

describe('the Figures 3D wiring', () => {
  it('lights the figure of a row the Team list hovers, and clears it when the row lets go', () => {
    const { container } = render(
      <TeamSceneDiorama model={{} as TeamPanelGameModel} onNoWebgl={() => {}} members={members} />
    )
    expect(stage.light).toHaveBeenLastCalledWith(null)
    act(() => useTeamSceneHover.getState().set('a'))
    expect(stage.light).toHaveBeenLastCalledWith('a')
    expect(canvasOf(container).dataset.dioramaLit).toBe('a')
    act(() => useTeamSceneHover.getState().set(null))
    expect(stage.light).toHaveBeenLastCalledWith(null)
    expect(canvasOf(container).dataset.dioramaLit).toBe('')
  })

  it('opens the member whose figure is clicked, as its Team row does', () => {
    stage.pick.mockReturnValue('a')
    const { container } = render(
      <TeamSceneDiorama model={{} as TeamPanelGameModel} onNoWebgl={() => {}} members={members} />
    )
    const el = canvasOf(container)
    fireEvent.pointerDown(el, { clientX: 60, clientY: 50, pointerType: 'mouse' })
    fireEvent.click(el, { clientX: 61, clientY: 50 })
    expect(open).toHaveBeenCalledTimes(1)
    stage.pick.mockReturnValue(null)
  })

  it('redraws under reduced motion when a row lights its figure, so the ring shows', () => {
    setReducedMotion(true)
    render(
      <TeamSceneDiorama model={{} as TeamPanelGameModel} onNoWebgl={() => {}} members={members} />
    )
    stage.draw.mockClear()
    act(() => useTeamSceneHover.getState().set('a'))
    expect(stage.draw).toHaveBeenCalledWith(1.3)
  })
})

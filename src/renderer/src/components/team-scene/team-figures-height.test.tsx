// @vitest-environment happy-dom

import * as THREE from 'three'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TeamPanelGameModel } from '../../../../shared/team-panel-model-types'
import { dioramaFitCamera, dioramaGrowFit } from './team-diorama-camera'
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
// The height that fits the islands at this width: Figures' default.
const FITTED = 220
vi.mock('./team-diorama-stage', () => ({
  dioramaRenderer: () => ({ dispose: () => {} }),
  dioramaStage: vi.fn((_r: unknown, args: { height?: number }) => ({
    height: Math.max(FITTED, args.height ?? 0),
    fitted: FITTED,
    draw: () => {},
    dispose: () => {},
    pick: () => null,
    light: () => {}
  }))
}))

const KEY = 'orca.teamFigures.height'
const asked = () => vi.mocked(dioramaStage).mock.calls.at(-1)![1].height
const drawn = () =>
  render(<TeamSceneDiorama model={{} as TeamPanelGameModel} onNoWebgl={() => {}} />)

beforeEach(() => {
  window.localStorage.clear()
  vi.mocked(dioramaStage).mockClear()
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
afterEach(cleanup)

describe('the Figures height', () => {
  it('opens at the height that fits the islands, and grows by dragging its edge to twice it', () => {
    const { getByRole } = drawn()
    expect(asked()).toBe(FITTED)
    const handle = getByRole('separator')
    expect(handle.getAttribute('aria-valuemax')).toBe(String(FITTED * 2))
    act(() => {
      fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1 })
      fireEvent.pointerMove(handle, { clientY: 200, pointerId: 1 })
      fireEvent.pointerUp(handle, { pointerId: 1 })
    })
    expect(asked()).toBe(320)
    expect(window.localStorage.getItem(KEY)).toBe('320')
    // The Office and the 2D building keep their own.
    expect(window.localStorage.getItem('orca.teamOffice3d.height')).toBeNull()
    expect(window.localStorage.getItem('orca.teamBuilding.height')).toBeNull()
    cleanup()
    drawn()
    expect(asked()).toBe(320)
  })

  it('never opens past twice the fit, and a double click goes back to the fit', () => {
    window.localStorage.setItem(KEY, '9000')
    const { getByRole } = drawn()
    expect(asked()).toBe(FITTED * 2)
    act(() => {
      fireEvent.doubleClick(getByRole('separator'))
    })
    expect(asked()).toBe(FITTED)
    expect(window.localStorage.getItem(KEY)).toBe('')
  })

  it('draws the world bigger on a taller canvas, keeping its vertical extent', () => {
    const world = new THREE.Group()
    world.add(new THREE.Mesh(new THREE.BoxGeometry(30, 1, 10), new THREE.MeshBasicMaterial()))
    const fit = dioramaFitCamera(world, 280)
    const width = fit.camera.right - fit.camera.left
    const top = fit.camera.top
    expect(dioramaGrowFit(fit, fit.height - 10)).toBe(fit)
    const grown = dioramaGrowFit(fit, fit.height * 2)
    expect(grown.height).toBe(fit.height * 2)
    expect(grown.camera.right - grown.camera.left).toBeCloseTo(width / 2)
    expect(grown.camera.top).toBeCloseTo(top)
    expect(grown.span).toBeCloseTo(fit.span / 2)
  })
})

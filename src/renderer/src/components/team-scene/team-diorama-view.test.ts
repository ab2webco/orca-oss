import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { DIORAMA_VIEW_XZ } from '../../../../shared/team-scene/team-diorama-lead-round'
import { DIORAMA_VIEW, type DioramaFit } from './team-diorama-camera'
import {
  dioramaAim,
  dioramaLeadZoom,
  dioramaPan,
  dioramaView,
  dioramaZoomBy
} from './team-diorama-view'

const fit = (): DioramaFit => ({
  camera: Object.assign(new THREE.OrthographicCamera(-20, 20, 10, -10, 0.1, 400)),
  height: 300,
  full: 300,
  ground: new THREE.Box3(),
  center: new THREE.Vector3(1, 0, 1),
  span: 40
})

describe('the diorama camera', () => {
  // The lead stops beside an asker as this camera sees it, so the shared rule must use its direction.
  it('looks along the ground direction the lead round assumes', () => {
    const ground = new THREE.Vector2(DIORAMA_VIEW.x, DIORAMA_VIEW.z).normalize()
    const assumed = new THREE.Vector2(...DIORAMA_VIEW_XZ).normalize()
    expect(ground.dot(assumed)).toBeCloseTo(1, 6)
  })

  it('follows the lead by default: it starts on it and eases after it, never jumping', () => {
    const view = dioramaView()
    const f = fit()
    const lead = new THREE.Vector3(-6, 0, 2)
    dioramaAim(view, f, lead, 400, 10)
    expect(view.target!.distanceTo(lead)).toBeLessThan(1e-9)
    expect(view.zoom).toBeCloseTo(dioramaLeadZoom(40), 9)
    lead.set(4, 0, 2)
    let last = view.target!.clone()
    for (let t = 10; t < 14; t += 1 / 30) {
      dioramaAim(view, f, lead, 400, t)
      expect(view.target!.distanceTo(last)).toBeLessThan(1.5)
      last = view.target!.clone()
    }
    expect(view.target!.distanceTo(lead)).toBeLessThan(0.05)
  })

  it('hands the camera to the viewer on a drag, moving the world with the pointer', () => {
    const view = dioramaView()
    const f = fit()
    dioramaAim(view, f, new THREE.Vector3(), 400, 1)
    const before = view.target!.clone()
    dioramaPan(view, 100, 0)
    expect(view.mode).toBe('free')
    dioramaAim(view, f, new THREE.Vector3(9, 0, 9), 400, 1.1)
    // A drag to the right moves the camera left over the world, not after the lead.
    const right = new THREE.Vector3().setFromMatrixColumn(f.camera.matrixWorld, 0)
    expect(view.target!.clone().sub(before).dot(right)).toBeLessThan(-1)
  })

  it('keeps a zoom between the whole world and a close look', () => {
    const view = dioramaView()
    dioramaZoomBy(view, 100)
    expect(view.goalZoom).toBe(5)
    dioramaZoomBy(view, 0.0001)
    expect(view.goalZoom).toBe(0.8)
  })

  it('eases to the whole world on Show all', () => {
    const view = dioramaView()
    const f = fit()
    dioramaAim(view, f, new THREE.Vector3(-8, 0, 0), 400, 1)
    view.mode = 'all'
    for (let t = 1; t < 9; t += 1 / 30) {
      dioramaAim(view, f, new THREE.Vector3(-8, 0, 0), 400, t)
    }
    expect(view.target!.distanceTo(f.center)).toBeLessThan(0.05)
    expect(view.zoom).toBeCloseTo(1, 1)
  })
})

import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Office3dFloor } from '../../../../shared/team-scene/team-office3d-layout'
import { DAY, dioramaKit } from './team-diorama-kit'
import { office3dConsolePlayed, office3dLobbyTv } from './team-office3d-lobby'
import { paintOffice3dTv } from './team-office3d-screens'

const status = { attention: '#e40014', done: '#15803d', working: '#0369a1', risk: '#b45309' }
const lobby: Office3dFloor = {
  key: 'lobby',
  name: '',
  lead: false,
  reachable: true,
  y: 0,
  width: 12,
  scale: 1,
  seats: [],
  used: 0,
  office: null,
  controlRoom: null,
  lobby: true
}

/** A 2D context that records each fill as `style@x,y`, so two paints can be compared. */
const recorder = () => {
  const fills: string[] = []
  const g = {
    fillStyle: '',
    fillRect(x: number, y: number) {
      fills.push(`${String(this.fillStyle)}@${Math.round(x)},${Math.round(y)}`)
    },
    clearRect: () => {}
  }
  return { g: g as unknown as CanvasRenderingContext2D, fills }
}

describe('the lobby TV', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is off with nobody at the console: one dark fill that never changes', () => {
    const a = recorder()
    const b = recorder()
    paintOffice3dTv(a.g, 256, 140, false, 0)
    paintOffice3dTv(b.g, 256, 140, false, 3.7)
    expect(a.fills).toHaveLength(1)
    expect(a.fills).toEqual(b.fills)
  })

  it('shows a game in motion while someone plays', () => {
    const a = recorder()
    const b = recorder()
    paintOffice3dTv(a.g, 256, 140, true, 0)
    paintOffice3dTv(b.g, 256, 140, true, 0.5)
    expect(a.fills.length).toBeGreaterThan(5)
    expect(a.fills).not.toEqual(b.fills)
  })

  it('counts as played only while a console seat on its own floor is taken', () => {
    expect(office3dConsolePlayed(new Set(['console:0:1']), 0)).toBe(true)
    expect(office3dConsolePlayed(new Set(['console:0:0', 'paddle:0:0']), 0)).toBe(true)
    expect(office3dConsolePlayed(new Set(['paddle:0:0', 'cafe:0:2']), 0)).toBe(false)
    expect(office3dConsolePlayed(new Set(['console:1:0']), 0)).toBe(false)
    expect(office3dConsolePlayed(new Set(), 0)).toBe(false)
  })

  it('repaints its screen from who is at the console each frame', () => {
    const screen = recorder()
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => screen.g })
    })
    let here = new Set<string>()
    const kit = dioramaKit(DAY, status)
    const tv = office3dLobbyTv(kit, lobby, 0, () => here)
    expect(tv.group).toBeInstanceOf(THREE.Group)
    tv.tick(1)
    expect(screen.fills).toHaveLength(1)
    here = new Set(['console:0:0'])
    screen.fills.length = 0
    tv.tick(2)
    expect(screen.fills.length).toBeGreaterThan(5)
    here = new Set()
    screen.fills.length = 0
    tv.tick(3)
    expect(screen.fills).toHaveLength(1)
  })

  it('repaints a running game at most 12 times a second', () => {
    const screen = recorder()
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => screen.g })
    })
    const tv = office3dLobbyTv(dioramaKit(DAY, status), lobby, 0, () => new Set(['console:0:1']))
    const paintsAt = (t: number) => {
      screen.fills.length = 0
      tv.tick(t)
      return screen.fills.length
    }
    expect(paintsAt(2)).toBeGreaterThan(5)
    expect(paintsAt(2.03)).toBe(0)
    expect(paintsAt(2.1)).toBeGreaterThan(5)
  })

  it('frees its screen texture with the stage', () => {
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => recorder().g })
    })
    const tv = office3dLobbyTv(dioramaKit(DAY, status), lobby, 0, () => new Set())
    const materials: THREE.MeshBasicMaterial[] = []
    tv.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined
      if (m?.map) {
        materials.push(m)
      }
    })
    expect(materials).toHaveLength(1)
    const freed = vi.spyOn(materials[0]!.map!, 'dispose')
    materials[0]!.dispose()
    expect(freed).toHaveBeenCalled()
  })
})

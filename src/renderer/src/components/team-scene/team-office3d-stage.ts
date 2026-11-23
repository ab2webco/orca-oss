import * as THREE from 'three'
import {
  office3dPlayOf,
  office3dSeatViewOf,
  type Office3dSeatView
} from '../../../../shared/team-scene/team-office3d-actions'
import {
  OFFICE3D_DEPTH,
  OFFICE3D_SEAT_Z,
  type Office3dLayout
} from '../../../../shared/team-scene/team-office3d-layout'
import type { TeamSceneInput } from '../../../../shared/team-scene/team-scene-types'
import type { TeamSceneStatusColors } from './team-scene-painter-marks'
import type { Office3dTraffic } from '../../../../shared/team-scene/team-office3d-traffic'
import { dioramaFitCamera } from './team-diorama-camera'
import { dioramaAim, dioramaLeadZoom, type DioramaView } from './team-diorama-view'
import type { DioramaFigure } from './team-diorama-figures'
import { dioramaChip } from './team-diorama-fx'
import { DAY, NIGHT, dioramaKit } from './team-diorama-kit'
import type { DioramaRenderLimits } from './team-diorama-stage'
import { office3dDev } from './team-office3d-dev'
import { office3dCallPanel, office3dMark } from './team-office3d-lift'
import {
  OFFICE3D_CHAIR_BACK,
  OFFICE3D_DAY,
  OFFICE3D_NIGHT,
  office3dFloor
} from './team-office3d-floor'
import {
  keepOffice3dChipsInFrame,
  keepOffice3dLabelLegible,
  office3dLabelOf
} from './team-office3d-labels'
import { paintOffice3dBoard, paintOffice3dScreen, paintOffice3dWall } from './team-office3d-screens'
import { OFFICE3D_SIT_Y, poseOffice3dSeated } from './team-office3d-seated-poses'
import { office3dLeadActor } from './team-office3d-lead-actor'
import { office3dLobby, office3dLobbyTv } from './team-office3d-lobby'
import {
  office3dLeavers,
  office3dMover,
  office3dRally,
  office3dRoomCounter
} from './team-office3d-cast'
import { office3dControlRoom, office3dLeadOffice } from './team-office3d-wing'
import { office3dRenderByFloor } from './team-office3d-floor-passes'
import { scene3dHoverMark, scene3dPick } from './team-scene3d-pick'

export type Office3dStage = {
  height: number
  /** The height that shows the building at full size at this width. */
  full: number
  draw: (t: number) => void
  /** The figure drawn under `at` (canvas px), by its Team row key: a member, 'lead' or 'advisor'. */
  pick: (at: { x: number; y: number }, size: { width: number; height: number }) => string | null
  /** Rings the figure of `key` from the next frame on; null clears it. */
  light: (key: string | null) => void
  dispose: () => void
}

/** How often a desk's monitor and board repaint; a canvas upload per frame per desk is waste. */
const REPAINT = 0.4

/** A figure on a machine that cannot be reached: see-through, as its desk's haze. */
function ghost(g: THREE.Object3D): void {
  g.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) {
      m.material = (m.material as THREE.Material).clone()
      Object.assign(m.material, { transparent: true, opacity: 0.35, depthWrite: false })
    }
  })
}

/** One read of the team as the 3D Office: every machine's floor, its desks, its advisor, the lead. */
export function office3dStage(
  renderer: THREE.WebGLRenderer,
  args: {
    width: number
    dark: boolean
    status: TeamSceneStatusColors
    input: TeamSceneInput
    layout: Office3dLayout
    pace: string
    maxHeight?: number
    limits?: DioramaRenderLimits
    /** The stage's exact height: the whole building is fitted into it. */
    height?: number
    /** The panel's camera, kept across reads: it follows the lead, frames it all, or stays put. */
    view?: DioramaView
    /** The building's traffic, kept across reads: the lead's trips come only from its events. */
    traffic?: Office3dTraffic
    words: { thisMachine: string; offline: string; lobby?: string }
  }
): Office3dStage {
  const { input, layout, dark } = args
  const kit = dioramaKit(dark ? NIGHT : DAY, args.status)
  const X = dark ? OFFICE3D_NIGHT : OFFICE3D_DAY
  const scene = new THREE.Scene()
  const limits = args.limits ?? { pixelRatio: 2, shadowMap: 2048 }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, limits.pixelRatio))
  renderer.shadowMap.enabled = true
  // Why see-through: the building stands on the panel's own background, not the islands' sea.
  renderer.setClearColor(0x000000, 0)
  const raw = (hex: number) => new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace)
  scene.add(
    new THREE.HemisphereLight(raw(kit.p.hemiSky), raw(kit.p.hemiGround), kit.p.hemi * Math.PI)
  )
  const sun = new THREE.DirectionalLight(raw(kit.p.sun), kit.p.sunI * Math.PI)
  sun.castShadow = true
  sun.shadow.mapSize.set(limits.shadowMap, limits.shadowMap)
  sun.shadow.bias = -0.0006
  scene.add(sun, sun.target)
  const world = new THREE.Group()
  scene.add(world)

  const members = new Map(input.members.map((m) => [m.key, m] as const))
  const ticks: ((t: number) => void)[] = []
  const chips: THREE.Sprite[] = []
  const views = new Map<string, Office3dSeatView>()
  const doors: THREE.Mesh[][] = []
  const drawn = new Set<string>()
  // The figures a Team row can light, by its key (ORCA-1336).
  const figures = new Map<string, THREE.Object3D>()
  const here = office3dRoomCounter(args.traffic)
  const calls: ((on: boolean) => void)[] = []
  for (const [i, floor] of layout.floors.entries()) {
    const built = office3dFloor(kit, floor, i === layout.floors.length - 1, dark)
    doors.push(built.doors)
    calls.push(office3dCallPanel(kit, X, built.group, i).light)
    world.add(built.group)
    if (floor.lobby) {
      world.add(office3dLobby(kit, X, floor))
      const tv = office3dLobbyTv(kit, floor, i, here)
      world.add(tv.group)
      ticks.push(tv.tick)
    }
    if (floor.office) {
      world.add(office3dLeadOffice(kit, X, floor))
    }
    const room = office3dControlRoom(kit, X, floor, dark)
    if (room && floor.controlRoom) {
      world.add(room.group)
      const advisor = office3dDev(`advisor:${floor.key}`, 'advisor')
      const [cx, cz] = floor.controlRoom.chair
      advisor.g.position.set(cx, 0, cz)
      advisor.baseY = floor.controlRoom.y + OFFICE3D_SIT_Y
      advisor.g.rotation.y = Math.PI - 0.35
      advisor.g.userData.seated = 'advisor'
      figures.set('advisor', figures.get('advisor') ?? advisor.g)
      world.add(advisor.g)
      ticks.push((t) => poseOffice3dSeated(advisor, 'type', t))
      const floorMembers = floor.seats.flatMap((s) => (s.key && members.get(s.key)) || [])
      let shown = -Infinity
      ticks.push((t) => {
        if (t - shown < REPAINT && t >= shown) {
          return
        }
        shown = t
        room.wall?.redraw((g, w, h) =>
          paintOffice3dWall(g, w, h, floorMembers, floor.reachable, args.status, t)
        )
      })
    }
    const chip = dioramaChip(office3dLabelOf(floor, args.words))
    // Why hung from the slab's front edge: above it, a chip kept legible at 219 px covered the row.
    chip.center.set(0, 1)
    chip.position.set(0.4, floor.y - 0.8, OFFICE3D_DEPTH + 0.4)
    world.add(chip)
    chips.push(chip)

    for (const [j, seat] of floor.seats.entries()) {
      const m = seat.key ? members.get(seat.key) : undefined
      const desk = built.desks[j]
      const view = m ? office3dSeatViewOf(m, floor.reachable) : null
      if (m && view) {
        views.set(m.key, view)
      }
      let figure: DioramaFigure | null = null
      if (m && view && !view.empty) {
        figure = office3dDev(m.characterKey ?? m.key, 'dev')
        figure.g.scale.multiplyScalar(floor.scale)
        // Why the chair's own centre: the desk sets its chair 0.08 behind the seat line, scaled.
        figure.g.position.set(seat.x, 0, OFFICE3D_SEAT_Z + OFFICE3D_CHAIR_BACK * floor.scale)
        figure.baseY = floor.y + OFFICE3D_SIT_Y * floor.scale
        figure.g.rotation.y = Math.PI
        figure.g.userData.seated = 'member'
        figures.set(m.key, figure.g)
        if (view.faded) {
          ghost(figure.g)
        }
        world.add(figure.g)
        let mark: THREE.Sprite | null = null
        if (view.mark) {
          mark = office3dMark(view.mark, args.status)
          mark.position.set(seat.x, floor.y + 2.3 * floor.scale, OFFICE3D_SEAT_Z)
          world.add(mark)
        }
        const key = m.key
        // With the building's traffic it goes where its state sends it; without, it sits.
        if (args.traffic?.members.has(key)) {
          drawn.add(key)
          const deskPose = view
          ticks.push(
            office3dMover({
              figure,
              member: () => args.traffic?.members.get(key),
              desk: (t) => office3dPlayOf(deskPose, j, t) ?? deskPose.pose,
              deskScale: floor.scale,
              here,
              mark
            })
          )
          figure = null
        }
      }
      let painted = -Infinity
      ticks.push((t) => {
        if (figure && view) {
          poseOffice3dSeated(figure, office3dPlayOf(view, j, t) ?? view.pose, t)
        }
        if (t - painted < REPAINT && t >= painted) {
          return
        }
        painted = t
        const screen = view?.screen ?? { kind: seat.kind === 'taken' ? 'idle' : 'off' }
        desk?.screen?.redraw((g, w, h) =>
          paintOffice3dScreen(g, w, h, screen, view?.virus ?? false, t, args.status)
        )
        desk?.board?.redraw((g, w, h) =>
          paintOffice3dBoard(g, w, h, view?.board ?? null, t, args.status.attention)
        )
      })
    }
  }

  if (args.traffic) {
    ticks.push(...office3dLeavers(world, args.traffic, drawn, here))
    ticks.push(office3dRally(kit, world, layout, here))
  }
  // The lead and the one cab it rides; askers first, then a word with whoever is typing.
  const { figure: lead, tick: leadTick } = office3dLeadActor(kit, X, world, {
    layout,
    input,
    plan: args.traffic?.lead ?? null,
    pace: args.pace,
    doors,
    calls,
    members: args.traffic?.members
  })
  ticks.push(leadTick)
  figures.set('lead', lead.g)
  const mark = scene3dHoverMark(world, args.status.working)
  let lit: string | null = null

  const fit = dioramaFitCamera(world, args.width, args.height ?? args.maxHeight, args.height)
  renderer.setSize(args.width, fit.height, true)
  // A chip's size depends on how many px a world unit takes at this width, sized in each draw.
  const pxPerUnit = args.width / (fit.camera.right - fit.camera.left)
  const reach = fit.ground.getSize(new THREE.Vector3()).length() / 2 + 2
  sun.target.position.copy(fit.center)
  sun.position.copy(fit.center).add(new THREE.Vector3(-14, 26, 10))
  Object.assign(sun.shadow.camera, {
    left: -reach,
    right: reach,
    top: reach,
    bottom: -reach,
    far: 40 + reach * 2
  })
  sun.shadow.camera.updateProjectionMatrix()

  // Why clamped: centred on a lead at the bottom floor, half the frame showed nothing under it.
  const right = new THREE.Vector3().setFromMatrixColumn(fit.camera.matrixWorld, 0)
  const up = new THREE.Vector3().setFromMatrixColumn(fit.camera.matrixWorld, 1)
  const { min, max } = fit.ground
  const corners = [min.x, max.x].flatMap((x) =>
    [min.y, max.y].flatMap((y) => [min.z, max.z].map((z) => new THREE.Vector3(x, y, z)))
  )
  const span = (axis: THREE.Vector3) => {
    const d = corners.map((c) => c.dot(axis))
    return [Math.min(...d), Math.max(...d)] as const
  }
  const [rights, ups] = [span(right), span(up)]
  const clampAxis = (v: number, [lo, hi]: readonly [number, number], half: number) =>
    hi - lo <= 2 * half ? (lo + hi) / 2 : Math.min(hi - half, Math.max(lo + half, v))
  const keepInside = (p: THREE.Vector3, zoom: number): THREE.Vector3 => {
    const r = p.dot(right)
    const u = p.dot(up)
    const r2 = clampAxis(r, rights, fit.camera.right / zoom)
    const u2 = clampAxis(u, ups, fit.camera.top / zoom)
    return p
      .clone()
      .addScaledVector(right, r2 - r)
      .addScaledVector(up, u2 - u)
  }

  return {
    height: fit.height,
    full: fit.full,
    draw: (t) => {
      for (const tick of ticks) {
        tick(t)
      }
      if (args.view) {
        const aim =
          args.view.mode === 'lead'
            ? keepInside(lead.g.position, dioramaLeadZoom(fit.span))
            : lead.g.position
        dioramaAim(args.view, fit, aim, args.width, t)
      }
      // Why each frame: a chip sized for the whole building grew with the follow zoom over the lead.
      for (const chip of chips) {
        keepOffice3dLabelLegible(chip, pxPerUnit * fit.camera.zoom)
      }
      keepOffice3dChipsInFrame(chips, fit.camera)
      // Why each frame: the lit figure may be walking; a hidden one would leave its ring floating.
      const f = lit ? figures.get(lit) : undefined
      mark.place(f?.visible ? f : null, figures.values())
      office3dRenderByFloor(renderer, scene, world, fit.camera, layout.floors.length)
    },
    pick: (at, size) => scene3dPick(fit.camera, figures, at, size),
    light: (key) => {
      lit = key
    },
    // Why the sun too: its shadow map lives outside the world, and leaked on every rebuild.
    dispose: () => {
      kit.dispose(world)
      sun.dispose()
    }
  }
}

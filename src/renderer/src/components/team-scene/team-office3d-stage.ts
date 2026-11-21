import * as THREE from 'three'
import {
  office3dPlayOf,
  office3dSeatViewOf,
  type Office3dSeatView
} from '../../../../shared/team-scene/team-office3d-actions'
import { office3dCabFloorAt } from '../../../../shared/team-scene/team-office3d-elevator'
import {
  OFFICE3D_DEPTH,
  OFFICE3D_PITCH,
  OFFICE3D_SEAT_Z,
  type Office3dLayout
} from '../../../../shared/team-scene/team-office3d-layout'
import {
  office3dLeadRoundOf,
  office3dWalkerAt
} from '../../../../shared/team-scene/team-office3d-walkers'
import type {
  TeamSceneInput,
  TeamSceneMemberInput
} from '../../../../shared/team-scene/team-scene-types'
import type { TeamSceneStatusColors } from './team-scene-painter-marks'
import { dioramaFitCamera } from './team-diorama-camera'
import { dioramaAim, type DioramaView } from './team-diorama-view'
import { dioramaLookOf, type DioramaFigure } from './team-diorama-figures'
import { dioramaChip } from './team-diorama-fx'
import { DAY, NIGHT, dioramaKit } from './team-diorama-kit'
import { poseDioramaFigure } from './team-diorama-poses'
import { OFFICE3D_LEAD_COAT, office3dDev } from './team-office3d-dev'
import { office3dLeadMark, office3dLiftShaft, office3dMark } from './team-office3d-lift'
import { OFFICE3D_DAY, OFFICE3D_NIGHT, office3dFloor } from './team-office3d-floor'
import { keepOffice3dLabelLegible, office3dLabelOf } from './team-office3d-labels'
import { paintOffice3dBoard, paintOffice3dScreen } from './team-office3d-screens'
import { poseOffice3dSeated } from './team-office3d-seated-poses'
import { office3dControlRoom, office3dLeadOffice } from './team-office3d-wing'

export type Office3dStage = { height: number; draw: (t: number) => void; dispose: () => void }

/** How often a desk's monitor and board repaint; a canvas upload per frame per desk is waste. */
const REPAINT = 0.4
/** A seated figure's lift off the floor at the diorama's 1.6 scale, as the approved prototype. */
const SIT_Y = 0.58 - 0.34 * 1.6

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

const tileOf = (m: TeamSceneMemberInput, reachable: boolean, c: TeamSceneStatusColors): string =>
  !reachable || m.away
    ? '#4b5563'
    : m.activity === 'needsYou'
      ? c.attention
      : m.activity === 'done'
        ? c.done
        : m.activity === 'blocked' || m.hold
          ? c.risk
          : c.working

/** The control room's video wall: one tile per member of its floor, in Orca's status colours. */
function paintWall(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  floorMembers: readonly TeamSceneMemberInput[],
  reachable: boolean,
  c: TeamSceneStatusColors,
  t: number
): void {
  g.fillStyle = '#0b1220'
  g.fillRect(0, 0, w, h)
  const cols = 8,
    tw = 42,
    th = 22,
    gap = 6
  for (const [k, m] of floorMembers.slice(0, 40).entries()) {
    const fill = tileOf(m, reachable, c)
    // Why a pulse on the asker's tile only: the wall says who needs the user at a glance.
    g.globalAlpha = fill === c.attention ? 0.65 + 0.35 * Math.abs(Math.sin(t * 3)) : 1
    g.fillStyle = fill
    g.fillRect(14 + (k % cols) * (tw + gap), 20 + Math.floor(k / cols) * (th + gap), tw, th)
  }
  g.globalAlpha = 1
  g.strokeStyle = '#7fb4ff'
  g.lineWidth = 2
  g.beginPath()
  for (let q = 0; q <= 40; q++) {
    const y = h - 16 - 16 * (0.5 + 0.5 * Math.sin(q * 0.55 + t * 0.8))
    if (q) {
      g.lineTo(14 + q * 9.3, y)
    } else {
      g.moveTo(14, y)
    }
  }
  g.stroke()
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
    /** The panel's camera, kept across reads: it follows the lead, frames it all, or stays put. */
    view?: DioramaView
    words: { thisMachine: string; offline: string }
  }
): Office3dStage {
  const { input, layout, dark } = args
  const kit = dioramaKit(dark ? NIGHT : DAY, args.status)
  const X = dark ? OFFICE3D_NIGHT : OFFICE3D_DAY
  const scene = new THREE.Scene()
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.shadowMap.enabled = true
  // Why see-through: the building stands on the panel's own background, not the islands' sea.
  renderer.setClearColor(0x000000, 0)
  const raw = (hex: number) => new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace)
  scene.add(
    new THREE.HemisphereLight(raw(kit.p.hemiSky), raw(kit.p.hemiGround), kit.p.hemi * Math.PI)
  )
  const sun = new THREE.DirectionalLight(raw(kit.p.sun), kit.p.sunI * Math.PI)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.bias = -0.0006
  scene.add(sun, sun.target)
  const world = new THREE.Group()
  scene.add(world)

  const members = new Map(input.members.map((m) => [m.key, m] as const))
  const ticks: ((t: number) => void)[] = []
  const chips: THREE.Sprite[] = []
  const views = new Map<string, Office3dSeatView>()
  for (const [i, floor] of layout.floors.entries()) {
    const built = office3dFloor(kit, floor, i === layout.floors.length - 1, dark)
    world.add(built.group)
    if (floor.office) {
      world.add(office3dLeadOffice(kit, X, floor))
    }
    const room = office3dControlRoom(kit, X, floor, dark)
    if (room && floor.controlRoom) {
      world.add(room.group)
      const advisor = office3dDev(dioramaLookOf(`advisor:${floor.key}`), 'advisor')
      const [cx, cz] = floor.controlRoom.chair
      advisor.g.position.set(cx, 0, cz)
      advisor.baseY = floor.controlRoom.y + SIT_Y
      advisor.g.rotation.y = Math.PI - 0.35
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
          paintWall(g, w, h, floorMembers, floor.reachable, args.status, t)
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
        figure = office3dDev(dioramaLookOf(m.characterKey ?? m.key), 'dev')
        figure.g.scale.multiplyScalar(floor.scale)
        figure.g.position.set(seat.x, 0, OFFICE3D_SEAT_Z)
        figure.baseY = floor.y + SIT_Y * floor.scale
        figure.g.rotation.y = Math.PI
        if (view.faded) {
          ghost(figure.g)
        }
        world.add(figure.g)
        if (view.mark) {
          const mark = office3dMark(view.mark, args.status)
          mark.position.set(seat.x, floor.y + 2.3 * floor.scale, OFFICE3D_SEAT_Z)
          world.add(mark)
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

  // The lead and the one cab it rides; askers first, then a word with whoever is typing.
  const keys = (pose: Office3dSeatView['pose']) =>
    input.members.filter((m) => views.get(m.key)?.pose === pose).map((m) => m.key)
  const round = office3dLeadRoundOf({
    layout,
    needs: keys('raise'),
    visits: keys('type'),
    pace: args.pace
  })
  const lead = office3dDev(dioramaLookOf(input.lead.characterKey ?? input.lead.key), 'lead')
  const leadScale = lead.g.scale.x
  world.add(lead.g)
  const { group: shaft, cab } = office3dLiftShaft(kit, X, layout.floors.length)
  world.add(shaft)
  const leadMark = office3dLeadMark(OFFICE3D_LEAD_COAT)
  world.add(leadMark)
  ticks.push((t) => {
    const at = office3dWalkerAt(round, t)
    lead.g.position.set(at.at[0], 0, at.at[1])
    // Why baseY: the diorama's poses set the figure's height from it on every frame.
    lead.baseY = at.floor * OFFICE3D_PITCH + (at.pose === 'desk' ? SIT_Y : 0)
    lead.g.scale.setScalar(leadScale * at.blink)
    if (at.heading && Math.hypot(at.heading[0], at.heading[1]) > 1e-6) {
      lead.g.rotation.y = Math.atan2(at.heading[0], at.heading[1])
    }
    if (at.pose === 'desk') {
      lead.g.rotation.y = 0
      poseOffice3dSeated(lead, 'type', t)
    } else {
      poseDioramaFigure(lead, at.pose === 'give' ? 'talk' : at.pose, t)
    }
    const tt = round.total > 0 ? t % round.total : 0
    cab.position.y = office3dCabFloorAt(round.cab, tt) * OFFICE3D_PITCH
    const p = lead.g.position
    leadMark.position.set(p.x, p.y + 2.5 + Math.sin(t * 2.4) * 0.06, p.z)
  })

  const fit = dioramaFitCamera(world, args.width, args.maxHeight)
  renderer.setSize(args.width, fit.height, true)
  // Why after the fit: a chip's size depends on how many px a world unit takes at this width.
  const pxPerUnit = args.width / (fit.camera.right - fit.camera.left)
  for (const chip of chips) {
    keepOffice3dLabelLegible(chip, pxPerUnit)
  }
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

  return {
    height: fit.height,
    draw: (t) => {
      for (const tick of ticks) {
        tick(t)
      }
      if (args.view) {
        dioramaAim(args.view, fit, lead.g.position, args.width, t)
      }
      renderer.render(scene, fit.camera)
    },
    dispose: () => kit.dispose(world)
  }
}

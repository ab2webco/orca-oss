import * as THREE from 'three'
import {
  office3dPlayOf,
  office3dSeatViewOf,
  type Office3dSeatView
} from '../../../../shared/team-scene/team-office3d-actions'
import { office3dCabFloorAt } from '../../../../shared/team-scene/team-office3d-elevator'
import {
  OFFICE3D_LIFT,
  OFFICE3D_PITCH,
  OFFICE3D_SEAT_Z,
  type Office3dLayout
} from '../../../../shared/team-scene/team-office3d-layout'
import {
  office3dLeadRoundOf,
  office3dWalkerAt
} from '../../../../shared/team-scene/team-office3d-walkers'
import type { TeamSceneInput } from '../../../../shared/team-scene/team-scene-types'
import type { TeamSceneStatusColors } from './team-scene-painter-marks'
import { dioramaFitCamera } from './team-diorama-camera'
import { dioramaLookOf, type DioramaFigure } from './team-diorama-figures'
import { dioramaChip } from './team-diorama-fx'
import { DAY, NIGHT, dioramaKit } from './team-diorama-kit'
import { poseDioramaFigure } from './team-diorama-poses'
import { office3dDev } from './team-office3d-dev'
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
    words: { thisMachine: string; offline: string }
  }
): Office3dStage {
  const { input, layout, dark } = args
  const kit = dioramaKit(dark ? NIGHT : DAY, args.status)
  const X = dark ? OFFICE3D_NIGHT : OFFICE3D_DAY
  const scene = new THREE.Scene()
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.shadowMap.enabled = true
  renderer.setClearColor(kit.p.sea)
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
      const jev = office3dDev(dioramaLookOf(`advisor:${floor.key}`), 'advisor')
      const [cx, cz] = floor.controlRoom.chair
      jev.g.position.set(cx, 0, cz)
      jev.baseY = floor.controlRoom.y + SIT_Y
      jev.g.rotation.y = Math.PI - 0.35
      world.add(jev.g)
      ticks.push((t) => poseOffice3dSeated(jev, 'type', t))
    }
    const chip = dioramaChip(office3dLabelOf(floor, args.words))
    chip.position.set(0.4, floor.y + 3.1, 5.4)
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
        world.add(figure.g)
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
  const cab = kit.mesh(
    kit.box(1.7, 0.12, 1.8),
    kit.mat(X.metal),
    OFFICE3D_LIFT[0],
    0,
    OFFICE3D_LIFT[1],
    world
  )
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
    cab.position.y = office3dCabFloorAt(round.cab, tt) * OFFICE3D_PITCH - 0.06
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
      renderer.render(scene, fit.camera)
    },
    dispose: () => kit.dispose(world)
  }
}

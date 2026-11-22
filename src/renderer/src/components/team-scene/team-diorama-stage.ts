import * as THREE from 'three'
import type { DioramaPlotView } from '../../../../shared/team-scene/team-diorama-actions'
import type { DioramaCue } from '../../../../shared/team-scene/team-diorama-cues'
import type { DioramaLayout } from '../../../../shared/team-scene/team-diorama-layout'
import type { DioramaPace } from '../../../../shared/team-scene/team-diorama-lead-round'
import type { TeamSceneInput } from '../../../../shared/team-scene/team-scene-types'
import type { TeamSceneStatusColors } from './team-scene-painter-marks'
import { dioramaAdvisor, DIORAMA_TOWER } from './team-diorama-advisor'
import { dioramaFitCamera, dioramaGrowFit } from './team-diorama-camera'
import { dioramaCast } from './team-diorama-cast'
import { dioramaCueEffects } from './team-diorama-cue-meshes'
import { DAY, NIGHT, dioramaKit } from './team-diorama-kit'
import { dioramaLeadActor } from './team-diorama-lead-actor'
import { scene3dHoverMark, scene3dPick } from './team-scene3d-hover'
import { dioramaRises } from './team-diorama-rise'
import { dioramaHomeProps } from './team-diorama-camp'
import { dioramaAim, type DioramaView } from './team-diorama-view'
import { dioramaWorld, type DioramaWords } from './team-diorama-world-meshes'

export type DioramaStage = {
  height: number
  /** The height that fits the whole world at this width: the stage's default. */
  fitted: number
  draw: (t: number) => void
  dispose: () => void
  /** The figure under a canvas point: a member's pane key, `lead` or `advisor`. */
  pick: (at: { x: number; y: number }, size: { width: number; height: number }) => string | null
  /** Rings the figure a Team row points at (same keys); null clears it. */
  light: (key: string | null) => void
}

/** The canvas's WebGL renderer, or null where WebGL does not open (hardware acceleration off). */
export function dioramaRenderer(
  canvas: HTMLCanvasElement,
  alpha = false
): THREE.WebGLRenderer | null {
  try {
    return new THREE.WebGLRenderer({ canvas, antialias: true, alpha })
  } catch {
    return null
  }
}

/** A client's caps on pixel ratio and shadow-map size; absent keeps the desktop's 2 and 2048. */
export type DioramaRenderLimits = { pixelRatio: number; shadowMap: number }

/** One read of the team as a lit world with its cast, its lead's round and the moments playing. */
export function dioramaStage(
  renderer: THREE.WebGLRenderer,
  args: {
    width: number
    dark: boolean
    status: TeamSceneStatusColors
    input: TeamSceneInput
    layout: DioramaLayout
    views: ReadonlyMap<string, DioramaPlotView>
    cues: readonly DioramaCue[]
    /** Low resources: flat figures, no shadows, one pixel per pixel. */
    lite: boolean
    pace: DioramaPace
    /** The camera, kept across reads: it follows the lead, frames everything, or stays put. */
    view: DioramaView
    /** The tallest the stage may be; the phone keeps its band short. */
    maxHeight?: number
    limits?: DioramaRenderLimits
    /** A taller stage the person dragged to; the world draws bigger in it. */
    height?: number
    /** The island chips' words; a client without them names only remote machines. */
    words?: DioramaWords
  }
): DioramaStage {
  const { input, layout, views, cues } = args
  const { lite } = args
  const kit = dioramaKit(args.dark ? NIGHT : DAY, args.status)
  const scene = new THREE.Scene()
  const limits = args.limits ?? { pixelRatio: 2, shadowMap: 2048 }
  renderer.setPixelRatio(lite ? 1 : Math.min(window.devicePixelRatio || 1, limits.pixelRatio))
  renderer.shadowMap.enabled = !lite
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.setClearColor(kit.p.sea)
  // Why π: three r155+ lights are physical; the approved prototype's (r128) were π brighter.
  // Why raw: r128 took a light's hex as linear, unconverted; r170 converts it, which shades sides darker.
  const raw = (hex: number) => new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace)
  scene.add(
    new THREE.HemisphereLight(raw(kit.p.hemiSky), raw(kit.p.hemiGround), kit.p.hemi * Math.PI)
  )
  const sun = new THREE.DirectionalLight(raw(kit.p.sun), kit.p.sunI * Math.PI)
  sun.castShadow = !lite
  sun.shadow.mapSize.set(limits.shadowMap, limits.shadowMap)
  // Why a bias: without it thin decks and planks shade themselves in stripes that shimmer.
  sun.shadow.bias = -0.0006
  sun.shadow.normalBias = 0.02
  scene.add(sun, sun.target)
  const built = dioramaWorld(kit, layout, views, args.words)
  const world = built.world
  scene.add(world)

  const ticks = [...built.ticks, ...dioramaHomeProps(kit, world, lite)]
  const stands = new Map([...built.stands].map(([key, s]) => [key, s.at] as const))
  const lead = dioramaLeadActor(kit, world, { layout, input, cues, lite, pace: args.pace, stands })
  const cast = dioramaCast(kit, world, { layout, views, input, cues, lite, stands: built.stands })
  ticks.push(...dioramaRises(world, cues), lead.tick, ...cast.ticks)
  const advisor = input.advisor ? dioramaAdvisor(kit, world, cues, lite, input.advisor.line) : null
  if (advisor) {
    ticks.push(advisor.tick)
  }
  const figures = new Map<string, THREE.Object3D>([
    ['lead', lead.figure.g],
    ...(advisor ? [['advisor', advisor.figure.g] as const] : []),
    ...[...cast.figures].map(([key, f]) => [key, f.g] as const)
  ])
  const mark = scene3dHoverMark(world, args.status.working)
  let lit: string | null = null
  const anchorOf = (key: string) => {
    const f = key === 'lead' ? lead.figure : cast.figures.get(key)
    return f ? f.g.position.clone() : null
  }
  ticks.push(
    ...dioramaCueEffects(
      kit,
      world,
      cues,
      anchorOf,
      advisor ? DIORAMA_TOWER.clone().setY(DIORAMA_TOWER.y + 1.3) : null
    )
  )

  const fitted = dioramaFitCamera(world, args.width, args.maxHeight)
  const fit = dioramaGrowFit(fitted, args.height ?? 0)
  renderer.setSize(args.width, fit.height, true)
  // The sun's shadow box covers the whole world, or shadows stop a few metres from the middle.
  const center = fit.ground.getCenter(new THREE.Vector3())
  const reach = fit.ground.getSize(new THREE.Vector3()).length() / 2 + 2
  sun.target.position.copy(center)
  sun.position.copy(center).add(new THREE.Vector3(-14, 26, 10))
  Object.assign(sun.shadow.camera, {
    left: -reach,
    right: reach,
    top: reach,
    bottom: -reach,
    near: 0.5,
    far: 40 + reach * 2
  })
  sun.shadow.camera.updateProjectionMatrix()

  return {
    height: fit.height,
    fitted: fitted.height,
    draw: (t) => {
      for (const tick of ticks) {
        tick(t)
      }
      dioramaAim(args.view, fit, lead.figure.g.position, args.width, t)
      // Why each frame: the lit figure may be walking.
      mark.place((lit && figures.get(lit)) || null)
      renderer.render(scene, fit.camera)
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

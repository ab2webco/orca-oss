// three.js HD-2D band: the scene's own land as smooth, lit, fogged depth layers, and its own costumes
// as crisp pixel billboards that cast real shadows. Built only from the scene definition.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  type MeshLambertMaterial,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  type Sprite,
  Vector3,
  WebGLRenderer
} from 'three'
import { daylightAt } from '../../../../../resources/claude-plugins/orca-game/hooks/hd-daylight'
import { mix } from '../../../../../resources/claude-plugins/orca-game/hooks/pixel-canvas'
import type {
  SceneDefinition,
  ScenePhase
} from '../../../../../resources/claude-plugins/orca-game/hooks/scenes/index'
import { billboardOf, createCast, pixelTextureOf } from './band-hd2d-cast'
import { DEPTH, groundOf, LAYER, ridgeOf, skyTextureOf, sunSpriteOf } from './band-hd2d-land'
import type { BandModel, BandScene, MemberRect } from './band-scene'
import { castOf, hd2dWorldOf, type Hd2dWorld } from './hd2d-world'
import { webglRendererNameOf } from './webgl-renderer-name'

/** Silhouette samples per layer; at the walk speed the camera loops about every ten minutes. */
const SAMPLES = 1600
const WALK_PER_S = 3.5
const SUN_DISTANCE = 600

export const createHd2dBandScene = (args: {
  scene: SceneDefinition
  hourOf: () => number
}): BandScene => {
  const canvas = document.createElement('canvas')
  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'default' })
  renderer.shadowMap.type = PCFSoftShadowMap
  const scene = new Scene()
  const camera = new PerspectiveCamera(20, 8, 1, 2000)
  scene.add(camera)
  const hemi = new HemisphereLight(0xffffff, 0x334422, 0.9)
  const sun = new DirectionalLight(0xffffff, 1.4)
  sun.shadow.mapSize.set(2048, 2048)
  Object.assign(sun.shadow.camera, { left: -160, right: 160, top: 80, bottom: -80, far: 800 })
  scene.add(hemi, sun, sun.target)
  const cast = createCast(args.scene)
  const costumes = new Map<string, ScenePhase>()

  let world: Hd2dWorld | null = null
  let worldHour = Number.NaN
  let land = new Group()
  let sunSprite: Sprite | null = null
  let pixels = 20
  let ground = 17
  let cssWidth = 1
  let cssHeight = 1
  let aspect = 8
  let rects: MemberRect[] = []
  let lastHourCheck = -Infinity

  const disposeLand = (): void => {
    land.traverse((object) => {
      if (object instanceof Mesh || object instanceof InstancedMesh) {
        object.geometry.dispose()
        const material = object.material as MeshLambertMaterial
        material.map?.dispose()
        material.dispose()
      }
    })
    scene.remove(land)
    if (sunSprite !== null) {
      sunSprite.material.map?.dispose()
      sunSprite.material.dispose()
      camera.remove(sunSprite)
    }
    scene.background = null
  }

  const build = (hour: number): void => {
    disposeLand()
    const next = hd2dWorldOf(args.scene, SAMPLES, daylightAt(hour))
    world = next
    worldHour = hour
    pixels = next.pixels
    ground = next.ground
    land = new Group()
    const sky = skyTextureOf(next)
    scene.background = sky
    const horizon = next.sky.at(-1) ?? 0x8ccaf5
    scene.fog = new Fog(horizon, DEPTH * 1.25, DEPTH * 5.2)
    const far = ridgeOf({
      heights: next.far.heights,
      scale: LAYER.far,
      top: mix(next.far.color, next.far.snow, 0.12),
      base: mix(next.far.color, horizon, 0.25),
      capAbove: next.pixels * 0.45,
      cap: next.far.snow
    })
    far.position.z = DEPTH * (1 - LAYER.far)
    const mid = ridgeOf({
      heights: next.mid.heights,
      scale: LAYER.mid,
      top: next.mid.color,
      base: mix(next.mid.color, 0x000000, 0.35)
    })
    mid.position.z = DEPTH * (1 - LAYER.mid)
    mid.receiveShadow = true
    land.add(far, mid, groundOf(next, SAMPLES * LAYER.mid))
    if (next.plants !== null) {
      const { image, lefts } = next.plants
      const plant = billboardOf(image, pixelTextureOf(image))
      const plants = new InstancedMesh(plant.geometry, plant.material, lefts.length)
      const place = new Object3D()
      lefts.forEach((left, i) => {
        place.position.set((left + image.width / 2) * LAYER.plants, 0, DEPTH * (1 - LAYER.plants))
        place.scale.setScalar(LAYER.plants)
        place.updateMatrix()
        plants.setMatrixAt(i, place.matrix)
      })
      plants.castShadow = true
      land.add(plants)
    }
    scene.add(land)
    sunSprite = sunSpriteOf(next)
    camera.add(sunSprite)
    const nightness = next.night
    hemi.color.setHex(mix(next.sky[0] ?? 0xffffff, 0xffffff, 0.35 + nightness * 0.3))
    hemi.groundColor.setHex(next.soil)
    // Why a high floor: the mod keeps figures readable after dark, and so must the billboards.
    hemi.intensity = 1.1 + (1 - nightness) * 0.3
    sun.color.setHex(mix(next.sun.color, 0xffffff, 0.45))
    sun.intensity = 0.2 + (1 - nightness) * 1.6
    frame()
  }

  const frame = (): void => {
    camera.fov = (2 * Math.atan(pixels / 2 / DEPTH) * 180) / Math.PI
    camera.aspect = aspect
    camera.updateProjectionMatrix()
    if (world !== null && sunSprite !== null) {
      const k = SUN_DISTANCE / DEPTH
      const x = (world.sun.x / SAMPLES - 0.5) * pixels * aspect * k
      const y = (pixels / 2 - world.sun.y) * k
      const size = Math.max(5, pixels * 0.3) * k
      sunSprite.position.set(x, y, -SUN_DISTANCE)
      sunSprite.scale.set(size, size, 1)
    }
  }

  const particleGeometry = new BufferGeometry()
  const particleMaterial = new PointsMaterial({ size: 0.9, transparent: true, vertexColors: true })
  const particles = new Points(particleGeometry, particleMaterial)
  camera.add(particles)
  let particleCount = 0
  const tint = new Color()
  const updateParticles = (t: number, model: BandModel): void => {
    const raining = model.ci === 'failure'
    const shown = raining || model.merged || (world?.night ?? 0) > 0.5
    particles.visible = shown && particleCount > 0
    if (!particles.visible) {
      return
    }
    const position = particleGeometry.getAttribute('position')
    const color = particleGeometry.getAttribute('color')
    const half = (pixels * aspect) / 2
    for (let i = 0; i < particleCount; i += 1) {
      const seed = ((i * 7919) % 1000) / 1000
      const fall = (t / (raining ? 700 : 4000) + seed * 7) % 1
      const x = -half + seed * 2 * half + Math.sin(t / 1300 + i) * 2
      const y =
        raining || model.merged ? pixels / 2 - fall * pixels : Math.sin(t / 900 + i) * 3 - seed * 4
      position.setXYZ(i, x, y, -DEPTH + (i % 3) * 6)
      tint.setHex(
        raining
          ? 0x9fb4e6
          : model.merged
            ? ([0xffd84a, 0x5fd3a0, 0xff7ab8][i % 3] ?? 0xffffff)
            : 0xfff6a0
      )
      color.setXYZ(i, tint.r, tint.g, tint.b)
    }
    position.needsUpdate = true
    color.needsUpdate = true
  }

  const projected = new Vector3()
  const toScreen = (x: number, y: number): { x: number; y: number } => {
    projected.set(x, y, 0).project(camera)
    return { x: ((projected.x + 1) / 2) * cssWidth, y: ((1 - projected.y) / 2) * cssHeight }
  }

  return {
    lib: 'three',
    canvas,
    rendererName: webglRendererNameOf(renderer.getContext()),
    resize(width, height, quality) {
      cssWidth = Math.max(1, width)
      cssHeight = Math.max(1, height)
      aspect = cssWidth / cssHeight
      renderer.setPixelRatio(Math.min(quality.pixelRatio, window.devicePixelRatio || 1))
      renderer.setSize(cssWidth, cssHeight, false)
      renderer.shadowMap.enabled = quality.shadows
      sun.castShadow = quality.shadows
      particleCount = quality.particles
      particleGeometry.setAttribute(
        'position',
        new BufferAttribute(new Float32Array(particleCount * 3), 3)
      )
      particleGeometry.setAttribute(
        'color',
        new BufferAttribute(new Float32Array(particleCount * 3), 3)
      )
      frame()
    },
    render(t, model) {
      if (t - lastHourCheck > 5000) {
        lastHourCheck = t
        const hour = Math.round(args.hourOf() * 4) / 4
        if (hour !== worldHour) {
          build(hour)
        }
      }
      const width = pixels * aspect
      const start = (width * LAYER.far) / 2
      const span = SAMPLES * LAYER.mid - start - width * LAYER.mid
      const x = start + (((t / 1000) * WALK_PER_S) % Math.max(1, span))
      camera.position.set(x, ground - pixels / 2, DEPTH)
      sun.position.set(x + ((world?.sun.x ?? SAMPLES / 2) / SAMPLES - 0.5) * 260, 160, DEPTH + 60)
      sun.target.position.set(x, 0, 0)
      const fog = scene.fog as Fog | null
      if (fog !== null && world !== null) {
        fog.color.setHex(world.sky.at(-1) ?? 0x8ccaf5)
        if (model.ci === 'failure') {
          fog.color.lerp(tint.setHex(0x40202a), 0.3 + Math.sin(t / 250) * 0.1)
        }
      }
      rects = []
      const order = castOf(args.scene, model.members)
      const count = model.members.length
      const pitch = Math.min(13, (width * 0.8) / Math.max(1, count))
      const lead = x + width * 0.08
      const followers = model.members.filter((one) => !one.isLead)
      model.members.forEach((member, i) => {
        const phase = costumes.get(member.key) ?? order.get(member.key) ?? 'working'
        costumes.set(member.key, phase)
        const figure = cast.pose(member, phase, t, i)
        const at = member.isLead ? lead : lead - (followers.indexOf(member) + 1) * pitch
        figure.root.position.set(at, 0, 0)
        if (figure.root.parent !== scene) {
          scene.add(figure.root)
        }
        const top = toScreen(at - 6, figure.height + 2)
        const bottom = toScreen(at + 6, 0)
        rects.push({
          key: member.key,
          x: top.x,
          y: top.y,
          width: bottom.x - top.x,
          height: bottom.y - top.y
        })
      })
      updateParticles(t, model)
      renderer.render(scene, camera)
    },
    memberRects: () => rects,
    dispose() {
      disposeLand()
      for (const figure of cast.figures.values()) {
        figure.root.traverse((object) => {
          if (object instanceof Mesh) {
            object.geometry.dispose()
          }
        })
      }
      cast.dispose()
      particleGeometry.dispose()
      particleMaterial.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
    }
  }
}

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
  WebGLRenderer
} from 'three'
import { daylightAt } from '../../../../../resources/claude-plugins/orca-game/hooks/hd-daylight'
import type { SceneDefinition } from '../../../../../resources/claude-plugins/orca-game/hooks/scenes/index'
import { billboardOf, createCast, pixelTextureOf } from './band-hd2d-cast'
import { groundOf, ridgeOf, skyTextureOf, sunSpriteOf } from './band-hd2d-land'
import type { BandModel, BandScene, MemberRect } from './band-scene'
import { createWardrobe } from './hd2d-cast-images'
import {
  cameraAt,
  DEPTH,
  FOG,
  LAYER,
  memberRectOf,
  memberXsOf,
  particleOf,
  particlesShownOf,
  SAMPLES,
  SUN_DISTANCE,
  sunDiscOf
} from './hd2d-layout'
import { lightsOf, sunOffsetOf } from './hd2d-lighting'
import { horizonOf, ridgesOf } from './hd2d-ridge'
import { hd2dWorldOf, type Hd2dWorld } from './hd2d-world'
import { webglRendererNameOf } from './webgl-renderer-name'

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
  const wardrobe = createWardrobe(args.scene)

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
    scene.fog = new Fog(horizonOf(next), FOG.near, FOG.far)
    const ridges = ridgesOf(next)
    const far = ridgeOf(ridges.far)
    far.position.z = DEPTH * (1 - LAYER.far)
    const mid = ridgeOf(ridges.mid)
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
    const lights = lightsOf(next)
    hemi.color.setHex(lights.hemiSky)
    hemi.groundColor.setHex(lights.hemiGround)
    hemi.intensity = lights.hemiIntensity
    sun.color.setHex(lights.sunColor)
    sun.intensity = lights.sunIntensity
    frame()
  }

  const frame = (): void => {
    camera.fov = (2 * Math.atan(pixels / 2 / DEPTH) * 180) / Math.PI
    camera.aspect = aspect
    camera.updateProjectionMatrix()
    if (world !== null && sunSprite !== null) {
      const k = SUN_DISTANCE / DEPTH
      const disc = sunDiscOf(world.sun, pixels, aspect)
      sunSprite.position.set(disc.x * k, disc.y * k, -SUN_DISTANCE)
      sunSprite.scale.set(disc.size * k, disc.size * k, 1)
    }
  }

  const particleGeometry = new BufferGeometry()
  const particleMaterial = new PointsMaterial({ size: 0.9, transparent: true, vertexColors: true })
  const particles = new Points(particleGeometry, particleMaterial)
  camera.add(particles)
  let particleCount = 0
  const tint = new Color()
  const updateParticles = (t: number, model: BandModel): void => {
    particles.visible = particlesShownOf(model, world?.night ?? 0) && particleCount > 0
    if (!particles.visible) {
      return
    }
    const position = particleGeometry.getAttribute('position')
    const color = particleGeometry.getAttribute('color')
    const raining = model.ci === 'failure'
    for (let i = 0; i < particleCount; i += 1) {
      const one = particleOf({
        i,
        t,
        raining,
        merged: model.merged,
        pixels,
        width: pixels * aspect
      })
      position.setXYZ(i, one.x, one.y, -one.distance)
      tint.setHex(one.color)
      color.setXYZ(i, tint.r, tint.g, tint.b)
    }
    position.needsUpdate = true
    color.needsUpdate = true
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
      const view = cameraAt(t, { pixels, ground, aspect })
      const x = view.x
      camera.position.set(x, view.y, DEPTH)
      const [dx, dy, dz] = world === null ? [0, 160, DEPTH + 60] : sunOffsetOf(world)
      sun.position.set(x + dx, dy, dz)
      sun.target.position.set(x, 0, 0)
      const fog = scene.fog as Fog | null
      if (fog !== null && world !== null) {
        fog.color.setHex(horizonOf(world))
        if (model.ci === 'failure') {
          fog.color.lerp(tint.setHex(0x40202a), 0.3 + Math.sin(t / 250) * 0.1)
        }
      }
      const phases = wardrobe(model.members)
      const xs = memberXsOf(model.members, view)
      const plane = { cssWidth, cssHeight, pixels }
      rects = model.members.map((member, i) => {
        const figure = cast.pose(member, phases[i] ?? 'working', t, i)
        const at = xs[i] ?? x
        figure.root.position.set(at, 0, 0)
        if (figure.root.parent !== scene) {
          scene.add(figure.root)
        }
        return memberRectOf(member.key, at, figure.height, view, plane)
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

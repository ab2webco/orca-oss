// OGL HD-2D band: the same land, cast, camera walk and particles as the three version, drawn with
// hand-written Lambert shaders; members get a blob shadow instead of a shadow map.
import { Camera, Geometry, Mesh, Renderer, Transform, type OGLRenderingContext } from 'ogl'
import { daylightAt } from '../../../../../resources/claude-plugins/orca-game/hooks/hd-daylight'
import type { SceneDefinition } from '../../../../../resources/claude-plugins/orca-game/hooks/scenes/index'
import { createOglCast } from './band-hd2d-ogl-cast'
import { applyLights, createGpuPool, createLightUniforms } from './band-hd2d-ogl-kit'
import { buildOglLand, type OglLand } from './band-hd2d-ogl-land'
import { POINT_FRAGMENT, POINT_VERTEX } from './band-hd2d-ogl-shaders'
import type { BandScene, MemberRect } from './band-scene'
import { createWardrobe } from './hd2d-cast-images'
import {
  cameraAt,
  DEPTH,
  memberRectOf,
  memberXsOf,
  particleOf,
  particlesShownOf,
  SAMPLES,
  SUN_DISTANCE,
  sunDiscOf
} from './hd2d-layout'
import { lightsOf, linearOf, type Rgb } from './hd2d-lighting'
import { horizonOf } from './hd2d-ridge'
import { hd2dWorldOf, type Hd2dWorld } from './hd2d-world'
import { webglRendererNameOf } from './webgl-renderer-name'

const FAILURE_FOG = linearOf(0x40202a)

export const createHd2dOglBandScene = (args: {
  scene: SceneDefinition
  hourOf: () => number
}): BandScene => {
  const canvas = document.createElement('canvas')
  const renderer = new Renderer({ canvas, antialias: true, dpr: 1 })
  const gl: OGLRenderingContext = renderer.gl
  // Why: OGL's state cache assumes LEQUAL but WebGL starts at LESS, so ties would keep the first draw.
  gl.depthFunc(gl.LEQUAL)
  const scene = new Transform()
  const camera = new Camera(gl, { fov: 20, near: 1, far: 2000, aspect: 8 })
  const light = createLightUniforms()
  const castPool = createGpuPool(gl)
  const landPool = createGpuPool(gl)
  const cast = createOglCast(gl, castPool, light, args.scene)
  const wardrobe = createWardrobe(args.scene)

  let world: Hd2dWorld | null = null
  let worldHour = Number.NaN
  let land: OglLand | null = null
  let sunDirection: Rgb = [0, 1, 0]
  let pixels = 20
  let ground = 17
  let cssWidth = 1
  let cssHeight = 1
  let aspect = 8
  let shadows = true
  let rects: MemberRect[] = []
  let lastHourCheck = -Infinity

  const build = (hour: number): void => {
    land?.root.setParent(null)
    landPool.free()
    const next = hd2dWorldOf(args.scene, SAMPLES, daylightAt(hour))
    world = next
    worldHour = hour
    pixels = next.pixels
    ground = next.ground
    land = buildOglLand(gl, landPool, light, next)
    land.root.setParent(scene)
    const lights = lightsOf(next)
    applyLights(light, lights)
    sunDirection = lights.sunDirection
    frame()
  }

  const frame = (): void => {
    camera.perspective({ fov: (2 * Math.atan(pixels / 2 / DEPTH) * 180) / Math.PI, aspect })
  }

  const pointScale = { value: 85 }
  const particleProgram = castPool.program({
    vertex: POINT_VERTEX,
    fragment: POINT_FRAGMENT,
    uniforms: {
      uFogColor: light.uFogColor,
      uFogNear: light.uFogNear,
      uFogFar: light.uFogFar,
      uSize: { value: 0.9 },
      uScale: pointScale
    },
    transparent: true,
    depthWrite: false
  })
  let particles: Mesh | null = null
  let particleGeometry: Geometry | null = null
  let particleXyz = new Float32Array(0)
  let particleRgb = new Float32Array(0)
  let particleCount = 0

  const updateParticles = (t: number, raining: boolean, merged: boolean, shown: boolean): void => {
    if (particles === null || particleGeometry === null) {
      return
    }
    particles.visible = shown
    const position = particleGeometry.attributes.position
    const color = particleGeometry.attributes.color
    if (!shown || position === undefined || color === undefined) {
      return
    }
    for (let i = 0; i < particleCount; i += 1) {
      const one = particleOf({ i, t, raining, merged, pixels, width: pixels * aspect })
      particleXyz.set([one.x, one.y, -one.distance], i * 3)
      particleRgb.set(linearOf(one.color), i * 3)
    }
    position.needsUpdate = true
    color.needsUpdate = true
  }

  return {
    lib: 'ogl',
    canvas,
    rendererName: webglRendererNameOf(gl),
    resize(width, height, quality) {
      cssWidth = Math.max(1, width)
      cssHeight = Math.max(1, height)
      aspect = cssWidth / cssHeight
      renderer.dpr = Math.min(quality.pixelRatio, window.devicePixelRatio || 1)
      renderer.setSize(cssWidth, cssHeight)
      shadows = quality.shadows
      pointScale.value = renderer.dpr * cssHeight * 0.5
      particles?.setParent(null)
      particleGeometry?.remove()
      particles = null
      particleGeometry = null
      particleCount = quality.particles
      if (particleCount > 0) {
        particleXyz = new Float32Array(particleCount * 3)
        particleRgb = new Float32Array(particleCount * 3)
        particleGeometry = new Geometry(gl, {
          position: { size: 3, data: particleXyz },
          color: { size: 3, data: particleRgb }
        })
        particles = new Mesh(gl, {
          mode: gl.POINTS,
          geometry: particleGeometry,
          program: particleProgram,
          frustumCulled: false
        })
        particles.setParent(scene)
      }
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
      camera.position.set(view.x, view.y, DEPTH)
      const raining = model.ci === 'failure'
      if (world !== null) {
        const horizon = linearOf(horizonOf(world))
        const k = raining ? 0.3 + Math.sin(t / 250) * 0.1 : 0
        light.uFogColor.value = horizon.map((c, i) => c + ((FAILURE_FOG[i] ?? 0) - c) * k)
      }
      if (world !== null && land !== null) {
        const disc = sunDiscOf(world.sun, pixels, aspect)
        const k = SUN_DISTANCE / DEPTH
        land.sun.position.set(view.x + disc.x * k, view.y + disc.y * k, DEPTH - SUN_DISTANCE)
        land.sun.scale.set(disc.size * k, disc.size * k, 1)
      }
      const phases = wardrobe(model.members)
      const xs = memberXsOf(model.members, view)
      const plane = { cssWidth, cssHeight, pixels }
      rects = model.members.map((member, i) => {
        const at = xs[i] ?? view.x
        const figure = cast.pose({
          member,
          phase: phases[i] ?? 'working',
          t,
          seed: i,
          at,
          parent: scene,
          shadows,
          sunDirection
        })
        return memberRectOf(member.key, at, figure.height, view, plane)
      })
      particles?.position.set(view.x, view.y, DEPTH)
      updateParticles(t, raining, model.merged, particlesShownOf(model, world?.night ?? 0))
      renderer.render({ scene, camera })
    },
    memberRects: () => rects,
    dispose() {
      particleGeometry?.remove()
      landPool.free()
      castPool.free()
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }
}

// pixi HD-2D band: the same land, cast, camera walk and particles as the three version, faked in 2D
// with per-layer parallax (1 / depth factor), baked Lambert colours and blob shadows.
import { Application, Container, Sprite, Texture } from 'pixi.js'
import { daylightAt } from '../../../../../resources/claude-plugins/orca-game/hooks/hd-daylight'
import type { SceneDefinition } from '../../../../../resources/claude-plugins/orca-game/hooks/scenes/index'
import { createPixiCast } from './band-hd2d-pixi-cast'
import { buildPixiLand, createLandShader, type PixiLand } from './band-hd2d-pixi-land'
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
  screenOf,
  sunDiscOf
} from './hd2d-layout'
import { lightsOf, linearOf, type Hd2dLights } from './hd2d-lighting'
import { horizonOf } from './hd2d-ridge'
import { hd2dWorldOf, type Hd2dWorld } from './hd2d-world'
import { webglRendererNameOf } from './webgl-renderer-name'

const FAILURE_FOG = linearOf(0x40202a)

export const createHd2dPixiBandScene = async (args: {
  scene: SceneDefinition
  hourOf: () => number
}): Promise<BandScene> => {
  const canvas = document.createElement('canvas')
  const app = new Application()
  await app.init({
    canvas,
    width: 800,
    height: 120,
    antialias: true,
    autoStart: false,
    preference: 'webgl'
  })
  const gl = app.renderer.gl
  const landShader = createLandShader()
  const landRoot = new Container()
  const blobs = new Container()
  const figures = new Container()
  const foreground = new Container()
  const particles = new Container()
  const heartsOn = new Container()
  const heartsOff = new Container()
  app.stage.addChild(landRoot, blobs, figures, foreground, heartsOn, heartsOff, particles)
  const cast = createPixiCast(args.scene, { blobs, figures, heartsOn, heartsOff })
  const wardrobe = createWardrobe(args.scene)

  let world: Hd2dWorld | null = null
  let lights: Hd2dLights | null = null
  let land: PixiLand | null = null
  let worldHour = Number.NaN
  let pixels = 20
  let ground = 17
  let cssWidth = 1
  let cssHeight = 1
  let shadows = true
  let rects: MemberRect[] = []
  let lastHourCheck = -Infinity

  const disposeLand = (): void => {
    if (land === null) {
      return
    }
    landRoot.removeChildren()
    foreground.removeChildren()
    land.foreground.destroy()
    for (const layer of land.layers) {
      layer.node.destroy({ children: true })
    }
    for (const geometry of land.geometries) {
      geometry.destroy(true)
    }
    land.sky.destroy()
    land.sun.destroy()
    for (const texture of land.textures) {
      texture.destroy(true)
    }
    land = null
  }

  const build = (hour: number): void => {
    disposeLand()
    const next = hd2dWorldOf(args.scene, SAMPLES, daylightAt(hour))
    world = next
    worldHour = hour
    pixels = next.pixels
    ground = next.ground
    lights = lightsOf(next)
    land = buildPixiLand(next, lights, landShader.shader)
    landRoot.addChild(land.sky, land.sun, ...land.layers.map((layer) => layer.node))
    foreground.addChild(land.foreground)
  }

  return {
    lib: 'pixi',
    canvas,
    rendererName: webglRendererNameOf(gl),
    resize(width, height, quality) {
      cssWidth = Math.max(1, width)
      cssHeight = Math.max(1, height)
      app.renderer.resize(
        cssWidth,
        cssHeight,
        Math.min(quality.pixelRatio, window.devicePixelRatio || 1)
      )
      shadows = quality.shadows
      for (const one of particles.removeChildren()) {
        one.destroy()
      }
      for (let i = 0; i < quality.particles; i += 1) {
        particles.addChild(new Sprite(Texture.WHITE))
      }
    },
    render(t, model) {
      if (t - lastHourCheck > 5000) {
        lastHourCheck = t
        const hour = Math.round(args.hourOf() * 4) / 4
        if (hour !== worldHour) {
          build(hour)
        }
      }
      const aspect = cssWidth / cssHeight
      const camera = cameraAt(t, { pixels, ground, aspect })
      const view = { cssWidth, cssHeight, pixels }
      const unit = cssHeight / pixels
      const raining = model.ci === 'failure'
      if (world !== null && land !== null && lights !== null) {
        const horizon = linearOf(horizonOf(world))
        const k = raining ? 0.3 + Math.sin(t / 250) * 0.1 : 0
        const fog = landShader.fog.uniforms.uFogColor
        if (fog instanceof Float32Array) {
          fog.set(horizon.map((c, i) => c + ((FAILURE_FOG[i] ?? 0) - c) * k))
          landShader.fog.update()
        }
        land.sky.width = cssWidth
        land.sky.height = cssHeight
        const disc = sunDiscOf(world.sun, pixels, aspect)
        land.sun.position.set(cssWidth / 2 + disc.x * unit, cssHeight / 2 - disc.y * unit)
        land.sun.width = disc.size * unit
        land.sun.height = disc.size * unit
        land.foreground.position.set(0, cssHeight / 2)
        land.foreground.scale.set(cssWidth, unit)
        for (const layer of land.layers) {
          if (layer.factor === null) {
            layer.node.position.set(0, cssHeight / 2)
            layer.node.scale.set(cssWidth, unit)
          } else {
            const origin = screenOf(camera, view, 0, 0, DEPTH * layer.factor)
            layer.node.position.set(origin.x, origin.y)
            layer.node.scale.set(unit / layer.factor)
          }
        }
        const phases = wardrobe(model.members)
        const xs = memberXsOf(model.members, camera)
        const lit = lights
        rects = model.members.map((member, i) => {
          const at = xs[i] ?? camera.x
          const figure = cast.pose({
            member,
            phase: phases[i] ?? 'working',
            t,
            seed: i,
            at,
            camera,
            view,
            shadows,
            lights: lit
          })
          return memberRectOf(member.key, at, figure.height, camera, view)
        })
      }
      particles.visible = particlesShownOf(model, world?.night ?? 0)
      if (particles.visible) {
        particles.children.forEach((one, i) => {
          const p = particleOf({ i, t, raining, merged: model.merged, pixels, width: camera.width })
          const k = DEPTH / p.distance
          one.position.set(cssWidth / 2 + p.x * unit * k, cssHeight / 2 - p.y * unit * k)
          // three's attenuated point size: 0.9 * (half the band height) / distance.
          one.scale.set((0.9 * cssHeight * 0.5) / p.distance)
          one.tint = p.color
        })
      }
      app.renderer.render(app.stage)
    },
    memberRects: () => rects,
    dispose() {
      disposeLand()
      cast.dispose()
      landShader.shader.destroy()
      landShader.fog.destroy()
      app.destroy({ removeView: true }, { children: true })
    }
  }
}

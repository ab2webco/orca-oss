import { Application, Container, Graphics } from 'pixi.js'
import type { BandModel, BandQuality, BandScene, MemberRect } from './band-scene'
import { MEMBER_COLORS } from './band-scene'
import {
  GROUND_DAY,
  GROUND_NIGHT,
  HEART_OFF,
  HEART_ON,
  heartScaleOf,
  mixColor,
  poseOf,
  SKIN,
  SKY_DAY,
  SKY_NIGHT
} from './band-stage'
import { webglRendererNameOf } from './webgl-renderer-name'

const MAX_HEARTS = 5

type Figure = { root: Container; body: Graphics; legs: [Graphics, Graphics]; hearts: Graphics[] }

const heart = (): Graphics =>
  new Graphics()
    .moveTo(0, 5)
    .bezierCurveTo(-9, -1, -4.5, -7.5, 0, -3)
    .bezierCurveTo(4.5, -7.5, 9, -1, 0, 5)
    .fill(0xffffff)

const hills = (width: number, height: number, amplitude: number, seed: number): Graphics => {
  const g = new Graphics().moveTo(0, height)
  for (let x = 0; x <= width * 2; x += 24) {
    g.lineTo(
      x,
      height * 0.55 -
        Math.sin(x / 90 + seed) * amplitude -
        Math.cos(x / 37 + seed) * amplitude * 0.3
    )
  }
  return g
    .lineTo(width * 2, height)
    .closePath()
    .fill(0xffffff)
}

export const createPixiBandScene = async (): Promise<BandScene> => {
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
  const sky = new Graphics().rect(0, 0, 1, 1).fill(0xffffff)
  const far = new Container()
  const near = new Container()
  const ground = new Graphics().rect(0, 0, 1, 1).fill(0xffffff)
  const stage = new Container()
  const particles = new Container()
  app.stage.addChild(sky, far, near, ground, stage, particles)

  let width = 800
  let height = 120
  let rects: MemberRect[] = []
  const figures = new Map<string, Figure>()

  const figureOf = (key: string, index: number, isLead: boolean): Figure => {
    const existing = figures.get(key)
    if (existing !== undefined) {
      return existing
    }
    const color = MEMBER_COLORS[index % MEMBER_COLORS.length] ?? 0xffffff
    const root = new Container()
    const legs: [Graphics, Graphics] = [
      new Graphics().rect(-2, 0, 4, 12).fill(color),
      new Graphics().rect(-2, 0, 4, 12).fill(color)
    ]
    legs[0].position.set(-4, -12)
    legs[1].position.set(4, -12)
    const body = new Graphics().roundRect(-10, -40, 20, 28, 8).fill(0xffffff)
    body.tint = color
    const head = new Graphics().circle(0, -48, 9).fill(SKIN)
    const hat = isLead
      ? new Graphics()
          .poly([-9, -55, -9, -63, -4, -59, 0, -66, 4, -59, 9, -63, 9, -55])
          .fill(0xffd34d)
      : new Graphics().poly([-9, -55, 9, -55, 0, -70]).fill(color)
    const hearts = Array.from({ length: MAX_HEARTS }, (_, slot) => {
      const one = heart()
      one.position.set((slot - (MAX_HEARTS - 1) / 2) * 9, -78)
      return one
    })
    root.addChild(...legs, body, head, hat, ...hearts)
    stage.addChild(root)
    const figure = { root, body, legs, hearts }
    figures.set(key, figure)
    return figure
  }

  const rebuildLayers = (count: number): void => {
    far.removeChildren().forEach((child) => child.destroy())
    near.removeChildren().forEach((child) => child.destroy())
    far.addChild(hills(width, height, height * 0.12, 1))
    near.addChild(hills(width, height, height * 0.07, 4))
    near.children[0]?.position.set(0, height * 0.12)
    particles.removeChildren().forEach((child) => child.destroy())
    for (let i = 0; i < count; i += 1) {
      particles.addChild(new Graphics().circle(0, 0, 1.6).fill(0xffffff))
    }
  }

  return {
    lib: 'pixi',
    canvas,
    rendererName: webglRendererNameOf(gl),
    resize(cssWidth, cssHeight, quality: BandQuality) {
      width = Math.max(1, cssWidth)
      height = Math.max(1, cssHeight)
      app.renderer.resize(width, height, Math.min(quality.pixelRatio, window.devicePixelRatio || 1))
      sky.scale.set(width, height)
      ground.position.set(0, height * 0.82)
      ground.scale.set(width, height * 0.18)
      rebuildLayers(quality.particles)
    },
    render(t, model: BandModel) {
      const day = model.daylight
      sky.tint =
        model.ci === 'failure'
          ? mixColor(mixColor(SKY_NIGHT, SKY_DAY, day), 0x40202a, 0.4)
          : mixColor(SKY_NIGHT, SKY_DAY, day)
      far.tint = mixColor(0x2a3a5a, 0x7aa0c8, day)
      near.tint = mixColor(0x1f3326, 0x4f8f4f, day)
      ground.tint = mixColor(GROUND_NIGHT, GROUND_DAY, day)
      far.position.x = -((t / 120) % width)
      near.position.x = -((t / 60) % width)
      const scale = height / 110
      rects = []
      model.members.forEach((member, index) => {
        const figure = figureOf(member.key, index, member.isLead)
        const count = model.members.length
        const baseX = width * (0.1 + (0.8 * index) / Math.max(1, count - 1))
        const pose = poseOf(member, 0, t, index)
        const x = baseX + pose.x * 40 * scale
        const y = height * 0.86 - pose.y * 40 * scale
        figure.root.position.set(x, y)
        figure.root.rotation = pose.tilt
        figure.root.scale.set(scale, scale * pose.squash)
        figure.legs[0].rotation = pose.legSwing
        figure.legs[1].rotation = -pose.legSwing
        figure.body.alpha = member.hurt && Math.sin(t / 90) > 0 ? 0.55 : 1
        figure.hearts.forEach((one, slot) => {
          one.tint = slot < member.lives ? HEART_ON : HEART_OFF
          one.scale.set(heartScaleOf(member, slot))
        })
        rects.push({
          key: member.key,
          x: x - 14 * scale,
          y: y - 86 * scale,
          width: 28 * scale,
          height: 86 * scale
        })
      })
      const raining = model.ci === 'failure'
      particles.visible = raining || model.merged || day < 0.35
      particles.children.forEach((one, i) => {
        const seed = ((i * 7919) % 1000) / 1000
        const fall = (t / (raining ? 600 : 3000) + seed * 7) % 1
        one.position.set(
          (seed * width + t * 0.02 * (i % 5)) % width,
          raining || model.merged
            ? fall * height
            : height * (0.3 + seed * 0.5) + Math.sin(t / 900 + i) * 6
        )
        one.tint = raining ? 0x8899ee : model.merged ? mixColor(0xff6688, 0x66ffaa, seed) : 0xfff27a
      })
      app.renderer.render(app.stage)
    },
    memberRects: () => rects,
    dispose() {
      app.destroy({ removeView: true }, { children: true })
    }
  }
}

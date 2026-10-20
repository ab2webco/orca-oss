import {
  Box,
  Camera,
  Cylinder,
  Geometry,
  Mesh,
  Plane,
  Program,
  Renderer,
  Sphere,
  Transform,
  Vec3
} from 'ogl'
import type { OGLRenderingContext } from 'ogl'
import type { BandModel, BandQuality, BandScene, MemberRect } from './band-scene'
import { MEMBER_COLORS } from './band-scene'
import {
  CAMERA,
  GROUND_DAY,
  GROUND_NIGHT,
  HEART_OFF,
  HEART_ON,
  halfWidthOf,
  heartScaleOf,
  memberXOf,
  mixColor,
  poseOf,
  SKIN,
  SKY_DAY,
  SKY_NIGHT
} from './band-stage'
import { FRAGMENT, POINT_FRAGMENT, POINT_VERTEX, VERTEX } from './band-ogl-shaders'
import { webglRendererNameOf } from './webgl-renderer-name'

const MAX_HEARTS = 5

const rgb = (hex: number): [number, number, number] => [
  ((hex >> 16) & 255) / 255,
  ((hex >> 8) & 255) / 255,
  (hex & 255) / 255
]

type Look = {
  uColor: { value: number[] }
  uEmissive: { value: number[] }
  uFog: { value: number[] }
  uSun: { value: number }
}

type Figure = {
  root: Transform
  legs: [Mesh, Mesh]
  hearts: Mesh[]
  body: Look
  heartLooks: Look[]
}

export const createOglBandScene = (): BandScene => {
  const canvas = document.createElement('canvas')
  const renderer = new Renderer({ canvas, antialias: true, dpr: 1 })
  const gl: OGLRenderingContext = renderer.gl
  const scene = new Transform()
  const camera = new Camera(gl, { fov: CAMERA.fov, near: 0.1, far: 60 })
  camera.position.set(0, CAMERA.y, CAMERA.z)
  camera.lookAt([0, CAMERA.lookY, 0])
  const fog = { value: rgb(SKY_DAY) as number[] }
  const sun = { value: 1 }
  const looks: Look[] = []
  const program = (hex: number): { program: Program; look: Look } => {
    const look: Look = {
      uColor: { value: rgb(hex) },
      uEmissive: { value: [0, 0, 0] },
      uFog: fog,
      uSun: sun
    }
    looks.push(look)
    return {
      program: new Program(gl, { vertex: VERTEX, fragment: FRAGMENT, uniforms: look }),
      look
    }
  }

  const groundGeometry = new Plane(gl, {
    width: 80,
    height: 18,
    widthSegments: 96,
    heightSegments: 12
  })
  const groundPositions = groundGeometry.attributes.position?.data
  if (groundPositions instanceof Float32Array) {
    for (let i = 0; i < groundPositions.length; i += 3) {
      const x = groundPositions[i] ?? 0
      const y = groundPositions[i + 1] ?? 0
      const far = Math.max(0, y - 2) / 7
      groundPositions[i + 2] =
        Math.sin(x * 0.35) * 0.25 * far + Math.cos(x * 0.13 + y) * 0.6 * far * far
    }
  }
  const ground = program(GROUND_DAY)
  const groundMesh = new Mesh(gl, { geometry: groundGeometry, program: ground.program })
  groundMesh.rotation.x = -Math.PI / 2
  groundMesh.position.z = -5
  groundMesh.setParent(scene)

  const treeGeometry = new Cylinder(gl, {
    radiusTop: 0,
    radiusBottom: 0.45,
    height: 1.4,
    radialSegments: 6
  })
  const tree = program(0x2f6b3a)
  for (let i = 0; i < 48; i += 1) {
    const mesh = new Mesh(gl, { geometry: treeGeometry, program: tree.program })
    mesh.position.set(-24 + i + Math.sin(i * 12.9) * 0.6, 0.7, -3.5 - (i % 3) * 1.6)
    mesh.scale.set(0.8 + ((i * 37) % 10) / 15)
    mesh.setParent(scene)
  }

  const shared = {
    body: new Box(gl, { width: 0.4, height: 0.62, depth: 0.3 }),
    head: new Sphere(gl, { radius: 0.2, widthSegments: 16, heightSegments: 12 }),
    hat: new Cylinder(gl, { radiusTop: 0, radiusBottom: 0.2, height: 0.32, radialSegments: 10 }),
    crown: new Cylinder(gl, {
      radiusTop: 0.2,
      radiusBottom: 0.16,
      height: 0.12,
      radialSegments: 10,
      openEnded: true
    }),
    leg: new Box(gl, { width: 0.09, height: 0.28, depth: 0.09 }),
    heart: new Sphere(gl, { radius: 0.06, widthSegments: 8, heightSegments: 6 })
  }
  const skin = program(SKIN)
  const gold = program(0xffd34d)

  const figures = new Map<string, Figure>()
  const figureOf = (key: string, index: number, isLead: boolean): Figure => {
    const existing = figures.get(key)
    if (existing !== undefined) {
      return existing
    }
    const body = program(MEMBER_COLORS[index % MEMBER_COLORS.length] ?? 0xffffff)
    const root = new Transform()
    const add = (geometry: Geometry, chosen: Program, x: number, y: number): Mesh => {
      const mesh = new Mesh(gl, { geometry, program: chosen })
      mesh.position.set(x, y, 0)
      mesh.setParent(root)
      return mesh
    }
    add(shared.body, body.program, 0, 0.6)
    add(shared.head, skin.program, 0, 1.02)
    add(
      isLead ? shared.crown : shared.hat,
      isLead ? gold.program : body.program,
      0,
      isLead ? 1.22 : 1.28
    )
    const legs: [Mesh, Mesh] = [
      add(shared.leg, body.program, -0.09, 0.16),
      add(shared.leg, body.program, 0.09, 0.16)
    ]
    const heartLooks: Look[] = []
    const hearts = Array.from({ length: MAX_HEARTS }, (_, slot) => {
      const look = program(HEART_ON)
      heartLooks.push(look.look)
      return add(shared.heart, look.program, (slot - (MAX_HEARTS - 1) / 2) * 0.17, 1.6)
    })
    root.setParent(scene)
    const figure = { root, legs, hearts, body: body.look, heartLooks }
    figures.set(key, figure)
    return figure
  }

  let particleMesh: Mesh | null = null
  const particleLook = {
    uColor: { value: [1, 0.95, 0.5] },
    uOpacity: { value: 0.9 },
    uSize: { value: 3 }
  }
  const particleProgram = new Program(gl, {
    vertex: POINT_VERTEX,
    fragment: POINT_FRAGMENT,
    uniforms: particleLook,
    transparent: true,
    depthWrite: false
  })
  let particleData = new Float32Array(0)

  let cssWidth = 1
  let cssHeight = 1
  let aspect = 8
  let rects: MemberRect[] = []

  return {
    lib: 'ogl',
    canvas,
    rendererName: webglRendererNameOf(gl),
    resize(width, height, quality: BandQuality) {
      cssWidth = Math.max(1, width)
      cssHeight = Math.max(1, height)
      aspect = cssWidth / cssHeight
      renderer.dpr = Math.min(quality.pixelRatio, window.devicePixelRatio || 1)
      renderer.setSize(cssWidth, cssHeight)
      camera.perspective({ aspect })
      particleMesh?.setParent(null)
      particleData = new Float32Array(quality.particles * 3)
      const geometry = new Geometry(gl, { position: { size: 3, data: particleData } })
      particleMesh = new Mesh(gl, { mode: gl.POINTS, geometry, program: particleProgram })
      particleMesh.setParent(scene)
    },
    render(t, model: BandModel) {
      const skyHex =
        model.ci === 'failure'
          ? mixColor(mixColor(SKY_NIGHT, SKY_DAY, model.daylight), 0x40202a, 0.4)
          : mixColor(SKY_NIGHT, SKY_DAY, model.daylight)
      const sky = rgb(skyHex)
      gl.clearColor(sky[0], sky[1], sky[2], 1)
      fog.value = sky
      sun.value = 0.4 + model.daylight * 0.9
      ground.look.uColor.value = rgb(mixColor(GROUND_NIGHT, GROUND_DAY, model.daylight))
      rects = []
      model.members.forEach((member, index) => {
        const figure = figureOf(member.key, index, member.isLead)
        const pose = poseOf(member, memberXOf(index, model.members.length, aspect), t, index)
        figure.root.position.set(pose.x, pose.y, 0)
        figure.root.rotation.z = pose.tilt
        figure.root.scale.set(1, pose.squash, 1)
        figure.legs[0].rotation.x = pose.legSwing
        figure.legs[1].rotation.x = -pose.legSwing
        figure.body.uEmissive.value =
          member.hurt && Math.sin(t / 90) > 0 ? [0.4, 0.05, 0.05] : [0, 0, 0]
        figure.hearts.forEach((heart, slot) => {
          heart.scale.set(heartScaleOf(member, slot))
          const look = figure.heartLooks[slot]
          if (look !== undefined) {
            look.uColor.value = rgb(slot < member.lives ? HEART_ON : HEART_OFF)
          }
        })
        const top = new Vec3(pose.x, 1.75, 0)
        const bottom = new Vec3(pose.x, 0, 0)
        camera.project(top)
        camera.project(bottom)
        const y0 = ((1 - top.y) / 2) * cssHeight
        const y1 = ((1 - bottom.y) / 2) * cssHeight
        const width = (y1 - y0) * 0.6
        rects.push({
          key: member.key,
          x: ((bottom.x + 1) / 2) * cssWidth - width / 2,
          y: y0,
          width,
          height: y1 - y0
        })
      })
      const half = halfWidthOf(aspect)
      const raining = model.ci === 'failure'
      for (let i = 0; i < particleData.length / 3; i += 1) {
        const seed = ((i * 7919) % 1000) / 1000
        const fall = (t / (raining ? 600 : 3000) + seed * 7) % 1
        particleData[i * 3] = -half + ((seed * 2 * half + t * 0.0003 * (i % 5)) % (2 * half))
        particleData[i * 3 + 1] =
          raining || model.merged
            ? 3.2 - fall * 3.4
            : 0.4 + Math.sin(t / 900 + i) * 0.4 + seed * 1.6
        particleData[i * 3 + 2] = -1 + (i % 4) * 0.5
      }
      const position = particleMesh?.geometry.attributes.position
      if (position !== undefined) {
        position.needsUpdate = true
      }
      particleLook.uColor.value = raining
        ? [0.5, 0.6, 0.9]
        : model.merged
          ? [0.6, 1, 0.6]
          : [1, 0.95, 0.5]
      particleLook.uOpacity.value = raining || model.merged || model.daylight < 0.35 ? 0.9 : 0
      renderer.render({ scene, camera })
    },
    memberRects: () => rects,
    dispose() {
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }
}

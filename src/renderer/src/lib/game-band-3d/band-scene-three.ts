import {
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  DirectionalLight,
  ExtrudeGeometry,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Scene,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  WebGLRenderer
} from 'three'
import type { BandModel, BandScene, MemberRect } from './band-scene'
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
import { webglRendererNameOf } from './webgl-renderer-name'

const MAX_HEARTS = 5

type Figure = {
  root: Group
  body: Mesh
  legs: [Mesh, Mesh]
  hearts: Mesh[]
  bodyMaterial: MeshStandardMaterial
}

const heartGeometry = (): ExtrudeGeometry => {
  const s = new Shape()
  s.moveTo(0, -0.5)
  s.bezierCurveTo(-0.9, 0.1, -0.45, 0.75, 0, 0.3)
  s.bezierCurveTo(0.45, 0.75, 0.9, 0.1, 0, -0.5)
  return new ExtrudeGeometry(s, { depth: 0.2, bevelEnabled: false })
}

export const createThreeBandScene = (): BandScene => {
  const canvas = document.createElement('canvas')
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'default'
  })
  renderer.shadowMap.type = PCFSoftShadowMap
  const scene = new Scene()
  scene.fog = new Fog(SKY_DAY, 9, 26)
  const camera = new PerspectiveCamera(CAMERA.fov, 8, 0.1, 60)
  camera.position.set(0, CAMERA.y, CAMERA.z)
  camera.lookAt(0, CAMERA.lookY, 0)

  const hemi = new HemisphereLight(0xffffff, 0x334422, 0.9)
  const ambient = new AmbientLight(0xffffff, 0.15)
  const sun = new DirectionalLight(0xffffff, 1.6)
  sun.position.set(-4, 8, 6)
  sun.shadow.mapSize.set(1024, 1024)
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 6, bottom: -4 })
  scene.add(hemi, ambient, sun)

  const groundGeometry = new PlaneGeometry(80, 18, 96, 12)
  const positions = groundGeometry.getAttribute('position')
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i)
    const y = positions.getY(i)
    const far = Math.max(0, y - 2) / 7
    positions.setZ(i, Math.sin(x * 0.35) * 0.25 * far + Math.cos(x * 0.13 + y) * 0.6 * far * far)
  }
  groundGeometry.computeVertexNormals()
  const groundMaterial = new MeshStandardMaterial({ color: GROUND_DAY, flatShading: true })
  const ground = new Mesh(groundGeometry, groundMaterial)
  ground.rotation.x = -Math.PI / 2
  ground.position.z = -5
  ground.receiveShadow = true
  scene.add(ground)

  const treeGeometry = new ConeGeometry(0.45, 1.4, 6)
  const treeMaterial = new MeshStandardMaterial({ color: 0x2f6b3a, flatShading: true })
  const trees = new InstancedMesh(treeGeometry, treeMaterial, 48)
  const place = new Object3D()
  for (let i = 0; i < 48; i += 1) {
    place.position.set(-24 + i + Math.sin(i * 12.9) * 0.6, 0.7, -3.5 - (i % 3) * 1.6)
    place.scale.setScalar(0.8 + ((i * 37) % 10) / 15)
    place.updateMatrix()
    trees.setMatrixAt(i, place.matrix)
  }
  trees.castShadow = true
  scene.add(trees)

  const shared = {
    body: new CapsuleGeometry(0.22, 0.38, 4, 10),
    head: new SphereGeometry(0.2, 16, 12),
    hat: new ConeGeometry(0.2, 0.32, 10),
    leg: new BoxGeometry(0.09, 0.28, 0.09),
    heart: heartGeometry(),
    crown: new TorusGeometry(0.17, 0.04, 6, 14)
  }
  const skin = new MeshStandardMaterial({ color: SKIN })
  const heartOn = new MeshStandardMaterial({ color: HEART_ON, emissive: 0x550011 })
  const heartOff = new MeshStandardMaterial({ color: HEART_OFF })
  const gold = new MeshStandardMaterial({ color: 0xffd34d, metalness: 0.6, roughness: 0.3 })

  const figures = new Map<string, Figure>()
  const figureOf = (key: string, index: number, isLead: boolean): Figure => {
    const existing = figures.get(key)
    if (existing !== undefined) {
      return existing
    }
    const color = MEMBER_COLORS[index % MEMBER_COLORS.length] ?? 0xffffff
    const bodyMaterial = new MeshStandardMaterial({ color })
    const root = new Group()
    const body = new Mesh(shared.body, bodyMaterial)
    body.position.y = 0.55
    const head = new Mesh(shared.head, skin)
    head.position.y = 1.02
    const hat = new Mesh(isLead ? shared.crown : shared.hat, isLead ? gold : bodyMaterial)
    hat.position.y = isLead ? 1.2 : 1.28
    if (isLead) {
      hat.rotation.x = Math.PI / 2
    }
    const legs: [Mesh, Mesh] = [
      new Mesh(shared.leg, bodyMaterial),
      new Mesh(shared.leg, bodyMaterial)
    ]
    legs[0].position.set(-0.09, 0.16, 0)
    legs[1].position.set(0.09, 0.16, 0)
    const hearts = Array.from({ length: MAX_HEARTS }, (_, slot) => {
      const heart = new Mesh(shared.heart, heartOn)
      heart.scale.setScalar(0.12)
      heart.position.set((slot - (MAX_HEARTS - 1) / 2) * 0.17, 1.6, 0)
      root.add(heart)
      return heart
    })
    for (const part of [body, head, hat, ...legs]) {
      part.castShadow = true
      root.add(part)
    }
    scene.add(root)
    const figure = { root, body, legs, hearts, bodyMaterial }
    figures.set(key, figure)
    return figure
  }

  const particleGeometry = new BufferGeometry()
  const particleMaterial = new PointsMaterial({
    size: 0.08,
    vertexColors: true,
    transparent: true,
    opacity: 0.9
  })
  const particles = new Points(particleGeometry, particleMaterial)
  scene.add(particles)
  let particleCount = 0

  let cssWidth = 1
  let cssHeight = 1
  let aspect = 8
  let rects: MemberRect[] = []
  const projected = new Vector3()
  const sky = new Color()

  const setParticles = (count: number): void => {
    particleCount = count
    particleGeometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3))
    particleGeometry.setAttribute('color', new BufferAttribute(new Float32Array(count * 3), 3))
  }

  const updateParticles = (t: number, model: BandModel): void => {
    const position = particleGeometry.getAttribute('position')
    const color = particleGeometry.getAttribute('color')
    const half = halfWidthOf(aspect)
    const raining = model.ci === 'failure'
    for (let i = 0; i < particleCount; i += 1) {
      const seed = ((i * 7919) % 1000) / 1000
      const x = -half + ((seed * 2 * half + t * 0.0003 * (i % 5)) % (2 * half))
      const fall = (t / (raining ? 600 : 3000) + seed * 7) % 1
      const y =
        raining || model.merged ? 3.2 - fall * 3.4 : 0.4 + Math.sin(t / 900 + i) * 0.4 + seed * 1.6
      position.setXYZ(i, x, y, -1 + (i % 4) * 0.5)
      const tint = raining ? [0.5, 0.6, 0.9] : model.merged ? [seed, 1 - seed, 0.6] : [1, 0.95, 0.5]
      color.setXYZ(i, tint[0] ?? 1, tint[1] ?? 1, tint[2] ?? 1)
    }
    position.needsUpdate = true
    color.needsUpdate = true
    particleMaterial.opacity = raining || model.merged || model.daylight < 0.35 ? 0.9 : 0
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
      camera.aspect = aspect
      camera.updateProjectionMatrix()
      setParticles(quality.particles)
    },
    render(t, model) {
      sky.setHex(mixColor(SKY_NIGHT, SKY_DAY, model.daylight))
      if (model.ci === 'failure') {
        sky.lerp(new Color(0x40202a), 0.35 + Math.sin(t / 250) * 0.1)
      }
      scene.background = sky
      scene.fog?.color.copy(sky)
      groundMaterial.color.setHex(mixColor(GROUND_NIGHT, GROUND_DAY, model.daylight))
      sun.intensity = 0.4 + model.daylight * 1.4
      rects = []
      model.members.forEach((member, index) => {
        const figure = figureOf(member.key, index, member.isLead)
        const pose = poseOf(member, memberXOf(index, model.members.length, aspect), t, index)
        figure.root.position.set(pose.x, pose.y, 0)
        figure.root.rotation.z = pose.tilt
        figure.root.scale.set(1, pose.squash, 1)
        figure.legs[0].rotation.x = pose.legSwing
        figure.legs[1].rotation.x = -pose.legSwing
        figure.bodyMaterial.emissive.setHex(
          member.hurt && Math.sin(t / 90) > 0 ? 0x661111 : 0x000000
        )
        figure.hearts.forEach((heart, slot) => {
          heart.material = slot < member.lives ? heartOn : heartOff
          heart.scale.setScalar(0.12 * heartScaleOf(member, slot))
          heart.rotation.y = t / 700 + slot
        })
        projected.set(pose.x, 1.75, 0).project(camera)
        const top = ((1 - projected.y) / 2) * cssHeight
        projected.set(pose.x, 0, 0).project(camera)
        const bottom = ((1 - projected.y) / 2) * cssHeight
        const cx = ((projected.x + 1) / 2) * cssWidth
        const width = (bottom - top) * 0.6
        rects.push({ key: member.key, x: cx - width / 2, y: top, width, height: bottom - top })
      })
      updateParticles(t, model)
      renderer.render(scene, camera)
    },
    memberRects: () => rects,
    dispose() {
      scene.traverse((object) => {
        if (object instanceof Mesh || object instanceof Points || object instanceof InstancedMesh) {
          object.geometry.dispose()
          const material = object.material
          for (const one of Array.isArray(material) ? material : [material]) {
            one.dispose()
          }
        }
      })
      renderer.dispose()
      renderer.forceContextLoss()
    }
  }
}

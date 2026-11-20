import * as THREE from 'three'
import type { DioramaTick } from './team-diorama-buildings'
import type { DioramaKit } from './team-diorama-kit'

// Why a port: the flames, smoke, confetti, the attention signal and the chips are the approved
// prototype's own (fire, smoke, confetti, signalSprite, chip; ORCA-1296).

/** Flickering flames with a glow: a red CI's roof in the attention colour, or the campfire. */
export function dioramaFire(
  k: DioramaKit,
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  hex: number | string,
  size = 1
): DioramaTick {
  const g = new THREE.Group()
  g.position.set(x, y, z)
  g.userData.fire = true
  parent.add(g)
  const core = new THREE.Color(hex).lerp(new THREE.Color(0xffe2a0), 0.6).getHex()
  const flames = Array.from({ length: 6 }, (_, n) =>
    k.mesh(
      new THREE.ConeGeometry(0.16 * size, 0.6 * size, 5),
      k.basic(n % 2 ? hex : core),
      (k.rnd() - 0.5) * 0.5 * size,
      0.25 * size,
      (k.rnd() - 0.5) * 0.5 * size,
      g,
      false
    )
  )
  const gl = k.glow(g, 0, 0.35 * size, 0, hex, 2.2 * size, 0.85)
  return (t) => {
    flames.forEach((f, n) => {
      f.scale.set(1, 0.8 + 0.22 * Math.sin(t * 4.2 + n * 1.7), 1)
      f.rotation.y = t * 0.8 + n
    })
    gl.material.opacity = 0.7 + Math.sin(t * 3.1) * 0.1
  }
}

/** Smoke puffs rising and fading over a burning roof. */
export function dioramaSmoke(
  k: DioramaKit,
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number
): DioramaTick {
  const puffs = Array.from({ length: 6 }, () => {
    const m = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.22, 0),
      k.mat(k.p.lit ? 0x4a4d55 : 0x8a8c90, { opacity: 0.75, unique: true })
    )
    parent.add(m)
    return m
  })
  return (t) =>
    puffs.forEach((m, n) => {
      const ph = (t * 0.28 + n / puffs.length) % 1
      m.position.set(x + ph * 0.7 + Math.sin(t + n) * 0.08, y + ph * 2.4, z - ph * 0.4)
      m.scale.setScalar(0.6 + ph * 1.8)
      ;(m.material as THREE.Material).opacity = 0.75 * (1 - ph)
    })
}

/** A merged build's confetti, bursting and falling in a loop. */
export function dioramaConfetti(
  k: DioramaKit,
  parent: THREE.Object3D,
  x: number,
  z: number
): DioramaTick {
  const cols = [k.status.done, 0xffffff, k.status.done, 0xe9edf2]
  const bits = Array.from({ length: 26 }, (_, n) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(0.1, 0.16),
      k.basic(cols[n % 4]!, { side: THREE.DoubleSide })
    )
    parent.add(m)
    return [m, k.rnd() * Math.PI * 2, 0.4 + k.rnd() * 1.1, k.rnd()] as const
  })
  return (t) =>
    bits.forEach(([m, a, r, o]) => {
      const ph = (t * 0.22 + o * 0.25) % 1
      const burst = 1 - (1 - Math.min(1, ph * 3)) ** 3
      m.position.set(
        x + Math.cos(a) * r * burst,
        3.2 + burst * 1.2 - ph * ph * 4.2,
        z + Math.sin(a) * r * burst
      )
      m.rotation.set(t * 1.6 + a, t * 1.1 + o * 9, 0)
      m.visible = ph < 0.92
    })
}

const roundRect = (
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) => {
  g.beginPath()
  if (g.roundRect) {
    g.roundRect(x, y, w, h, r)
  } else {
    g.rect(x, y, w, h)
  }
  g.fill()
}

const spriteOf = (c: HTMLCanvasElement, order: number): THREE.Sprite => {
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true })
  )
  s.renderOrder = order
  return s
}

const canvas2d = (): [HTMLCanvasElement, CanvasRenderingContext2D] | null => {
  const c = typeof document === 'undefined' ? null : document.createElement('canvas')
  const g = c?.getContext('2d')
  return c && g ? [c, g] : null
}

/** Needs you: the white-rimmed attention sign with its exclamation mark. */
export function dioramaSignal(k: DioramaKit): THREE.Sprite {
  const drawn = canvas2d()
  if (!drawn) {
    return new THREE.Sprite(new THREE.SpriteMaterial({ color: k.status.attention }))
  }
  const [c, g] = drawn
  c.width = 112
  c.height = 140
  g.fillStyle = '#ffffff'
  roundRect(g, 4, 4, 104, 132, 30)
  g.fillStyle = `#${new THREE.Color(k.status.attention).getHexString()}`
  roundRect(g, 12, 12, 88, 116, 24)
  g.fillStyle = '#ffffff'
  roundRect(g, 46, 28, 20, 56, 8)
  g.beginPath()
  g.arc(56, 104, 11, 0, Math.PI * 2)
  g.fill()
  const s = spriteOf(c, 11)
  s.scale.set(0.62, 0.78, 1)
  return s
}

/** A dark rounded label, as the prototype names each island. */
export function dioramaChip(text: string): THREE.Sprite {
  const drawn = canvas2d()
  if (!drawn) {
    return new THREE.Sprite()
  }
  const [c, g] = drawn
  const font = '600 30px Geist, ui-sans-serif, system-ui, sans-serif'
  g.font = font
  const w = Math.ceil(g.measureText(text).width) + 32
  c.width = w
  c.height = 48
  g.font = font
  g.fillStyle = 'rgba(12,14,18,0.78)'
  roundRect(g, 0, 0, w, 48, 12)
  g.fillStyle = '#f7f8f9'
  g.textBaseline = 'middle'
  g.fillText(text, 16, 25)
  const s = spriteOf(c, 10)
  s.scale.set((0.62 * w) / 48, 0.62, 1)
  s.center.set(0, 0)
  return s
}

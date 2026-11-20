import * as THREE from 'three'
import { dioramaCuePhase, type DioramaCue } from '../../../../shared/team-scene/team-diorama-cues'
import type { TeamSceneVerdictTone } from '../../../../shared/team-scene/team-scene-types'
import type { DioramaKit } from './team-diorama-kit'
import type { DioramaTick } from './team-diorama-props'

// Why every effect eases in and fades out: the owner asked for smooth motion, nothing that pops
// (ORCA-1296). Each effect hides itself outside its cue's time.

const ease = (x: number) => {
  const k = Math.max(0, Math.min(1, x))
  return k * k * (3 - 2 * k)
}

const fading = (hex: number | string, opacity: number) =>
  new THREE.MeshBasicMaterial({
    color: hex,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide
  })

/** The status colour a tone reads as on the cards. */
export const dioramaToneColor = (k: DioramaKit, tone: TeamSceneVerdictTone): string =>
  ({ allow: k.status.done, ask: k.status.attention, deny: k.status.risk, note: k.status.working })[
    tone
  ]

/** A dust puff on the ground at `at`, from `start` for 0.9 s: where someone appears. */
export function dioramaPoof(
  parent: THREE.Object3D,
  at: [number, number],
  start: number
): DioramaTick {
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.32, 24), fading(0xffffff, 0.7))
  ring.rotation.x = -Math.PI / 2
  parent.add(ring)
  const balls = [0, 1, 2, 3, 4, 5].map((n) => {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 1), fading(0xf2efe8, 0.85))
    parent.add(m)
    return [m, (n / 6) * Math.PI * 2] as const
  })
  return (t) => {
    const k = (t - start) / 0.9
    const on = k >= 0 && k < 1
    ring.visible = on
    for (const [m, a] of balls) {
      m.visible = on
      if (on) {
        m.position.set(at[0] + Math.cos(a) * k * 0.9, 0.3 + k * 0.6, at[1] + Math.sin(a) * k * 0.9)
        m.scale.setScalar(1 + k * 1.2)
        ;(m.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - k)
      }
    }
    if (on) {
      ring.position.set(at[0], 0.05, at[1])
      ring.scale.setScalar(1 + k * 4)
      ;(ring.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - k)
    }
  }
}

function confetti(k: DioramaKit, parent: THREE.Object3D, at: THREE.Vector3, c: DioramaCue) {
  const colors = [k.status.done, '#ffffff', k.status.done, '#e9edf2']
  const bits = Array.from({ length: 26 }, (_, n) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.16), fading(colors[n % 4]!, 1))
    parent.add(m)
    // Why a fixed spread, not random: two builds of one moment draw the same burst.
    return [m, (n * 2.39996) % (Math.PI * 2), 0.4 + ((n * 7) % 11) / 10] as const
  })
  return (t: number) => {
    const ph = dioramaCuePhase(c, t)
    for (const [m, a, r] of bits) {
      m.visible = ph >= 0 && ph < 1
      if (m.visible) {
        const burst = 1 - (1 - Math.min(1, ph * 3)) ** 3
        m.position.set(
          at.x + Math.cos(a) * r * burst,
          3.2 + burst * 1.2 - ph * ph * 4,
          at.z + Math.sin(a) * r * burst
        )
        m.rotation.set(t * 1.6 + a, t * 1.1 + r * 9, 0)
        ;(m.material as THREE.MeshBasicMaterial).opacity = 1 - ease((ph - 0.75) / 0.25)
      }
    }
  }
}

function flash(k: DioramaKit, parent: THREE.Object3D, at: THREE.Vector3, c: DioramaCue) {
  const color = dioramaToneColor(k, c.tone)
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.75, 32), fading(color, 0.8))
  ring.rotation.x = -Math.PI / 2
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.6, 0.6, 3, 24, 1, true),
    fading(color, 0.3)
  )
  parent.add(ring, beam)
  return (t: number) => {
    const ph = dioramaCuePhase(c, t)
    ring.visible = beam.visible = ph >= 0 && ph < 1
    if (ring.visible) {
      const glow = Math.sin(Math.PI * ease(ph))
      ring.position.set(at.x, 0.08, at.z)
      ring.scale.setScalar(1 + ease(ph) * 1.4)
      ;(ring.material as THREE.MeshBasicMaterial).opacity = 0.8 * glow
      beam.position.set(at.x, 1.5, at.z)
      ;(beam.material as THREE.MeshBasicMaterial).opacity = 0.28 * glow
    }
  }
}

/** The advisor's messenger bird: off the tower, over in an arc, a moment at the member, gone. */
function bird(
  k: DioramaKit,
  parent: THREE.Object3D,
  from: THREE.Vector3,
  to: () => THREE.Vector3 | null,
  c: DioramaCue
) {
  const g = new THREE.Group()
  parent.add(g)
  k.mesh(new THREE.SphereGeometry(0.12, 10, 8), k.mat(0xf2f2f2), 0, 0, 0, g).scale.set(1, 0.85, 1.5)
  k.mesh(new THREE.SphereGeometry(0.07, 8, 6), k.mat(dioramaToneColor(k, c.tone)), 0, -0.1, 0, g)
  const wings = [-0.17, 0.17].map((x) => {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.12), fading(0xe6e6e6, 1))
    w.position.x = x
    g.add(w)
    return w
  })
  return (t: number) => {
    const ph = dioramaCuePhase(c, t)
    const end = to()
    g.visible = ph >= 0 && ph < 1 && end !== null
    if (!g.visible || !end) {
      return
    }
    const fly = ease(ph / 0.75)
    const pos = from.clone().lerp(end, fly)
    pos.y += Math.sin(fly * Math.PI) * 1.6
    g.position.copy(pos)
    g.lookAt(end.x, pos.y, end.z)
    const flap = Math.sin(t * 14) * 0.6
    wings[0]!.rotation.z = flap
    wings[1]!.rotation.z = -flap
    g.scale.setScalar(1 - ease((ph - 0.85) / 0.15))
  }
}

/**
 * The cues a build draws on top of the world: confetti, a ring of light, the bird. `anchorOf`
 * reads where a member (or the lead) stands each frame, so the bird follows one that walks.
 */
export function dioramaCueEffects(
  k: DioramaKit,
  parent: THREE.Object3D,
  cues: readonly DioramaCue[],
  anchorOf: (key: string) => THREE.Vector3 | null,
  tower: THREE.Vector3 | null
): DioramaTick[] {
  const ticks: DioramaTick[] = []
  for (const c of cues) {
    const at = anchorOf(c.key)
    if (c.kind === 'confetti' && at) {
      ticks.push(confetti(k, parent, at, c))
    } else if (c.kind === 'flash' && at) {
      ticks.push(flash(k, parent, at, c))
    } else if (c.kind === 'bird' && tower) {
      ticks.push(
        bird(k, parent, tower, () => anchorOf(c.key)?.add(new THREE.Vector3(0, 1.9, 0)) ?? null, c)
      )
    }
  }
  return ticks
}

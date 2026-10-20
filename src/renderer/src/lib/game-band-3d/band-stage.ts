// Shared staging for the 3D scenes: camera framing, where members stand, how they move.
import type { BandMember } from './band-scene'

export const CAMERA = { fov: 28, y: 1.5, z: 9, lookY: 0.75 } as const

/** Half the visible width at z = 0 for a band of this aspect. */
export const halfWidthOf = (aspect: number): number =>
  Math.tan(((CAMERA.fov / 2) * Math.PI) / 180) *
  Math.hypot(CAMERA.z, CAMERA.y - CAMERA.lookY) *
  aspect

export const memberXOf = (index: number, count: number, aspect: number): number => {
  const span = halfWidthOf(aspect) * 1.6
  return count <= 1 ? 0 : -span / 2 + (span * index) / (count - 1)
}

export type Pose = { x: number; y: number; tilt: number; legSwing: number; squash: number }

export const poseOf = (member: BandMember, baseX: number, t: number, seed: number): Pose => {
  const phase = t / 1000 + seed * 1.7
  if (member.benched) {
    return { x: baseX, y: 0.12, tilt: Math.PI / 2, legSwing: 0, squash: 1 }
  }
  switch (member.state) {
    case 'working':
      return {
        x: baseX + Math.sin(phase * 0.6) * 0.35,
        y: Math.abs(Math.sin(phase * 6)) * 0.06,
        tilt: member.hurt ? Math.sin(phase * 30) * 0.12 : 0,
        legSwing: Math.sin(phase * 6) * 0.5,
        squash: 1
      }
    case 'waiting':
      return { x: baseX, y: Math.abs(Math.sin(phase * 4)) * 0.35, tilt: 0, legSwing: 0, squash: 1 }
    case 'done':
      return { x: baseX, y: 0, tilt: 0, legSwing: 0, squash: 0.85 }
    case 'idle':
      return { x: baseX, y: 0, tilt: Math.sin(phase) * 0.06, legSwing: 0, squash: 1 }
  }
}

/** Scale of the heart at `slot` while a life is won (pop in) or lost (shrink out). */
export const heartScaleOf = (member: BandMember, slot: number): number => {
  const change = member.lifeChange
  const filled = slot < member.lives
  if (change === null || change.ageMs > 1200) {
    return filled ? 1 : 0.55
  }
  const k = change.ageMs / 1200
  const changedSlot =
    change.delta > 0
      ? slot >= member.lives - change.delta && filled
      : !filled && slot < member.lives - change.delta
  if (!changedSlot) {
    return filled ? 1 : 0.55
  }
  return change.delta > 0 ? 1 + Math.sin(k * Math.PI) * 0.9 : 1.6 - k * 1.05
}

export const mixColor = (a: number, b: number, t: number): number => {
  const channel = (shift: number): number =>
    Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t)
  return (channel(16) << 16) | (channel(8) << 8) | channel(0)
}

export const SKY_NIGHT = 0x0d1330
export const SKY_DAY = 0x8ccaf5
export const GROUND_NIGHT = 0x1d3b2a
export const GROUND_DAY = 0x5fae5a
export const HEART_ON = 0xff4d6d
export const HEART_OFF = 0x5a5a6e
export const SKIN = 0xf3d2b3

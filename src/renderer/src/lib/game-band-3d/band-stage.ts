// How a member's hearts animate when a life is won or lost.
import type { BandMember } from './band-scene'

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

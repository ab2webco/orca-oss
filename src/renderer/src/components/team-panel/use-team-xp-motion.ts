import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import type { TeamXp } from '../../../../shared/team-xp-model'
import { isTeamLevelUp, teamXpGainOf, teamXpLeftOf, type TeamXpGain } from './team-xp-gain'

/**
 * grow: the gain fills in green; settle: it fades into the bar. A level-up's old level fills,
 * the sweep crosses it as the level changes, then the new level lands with the carry-over.
 */
export type TeamXpPhase = 'grow' | 'settle' | 'fill' | 'sweep' | 'landed'

/** `at` is each phase's start in ms; `done` ends the play. */
type Steps = Partial<Record<TeamXpPhase | 'done', number>>

export type TeamXpMotion = {
  key: number
  gain: TeamXpGain
  phase: TeamXpPhase
  still: boolean
  steps: Steps
}

// The clip the owner approved on ORCA-1264, in ms from the poll that brought the gain.
const GAIN_STEPS: Steps = { grow: 0, settle: 1600, done: 2800 }
const LEVEL_STEPS: Steps = { fill: 0, sweep: 450, landed: 1150, done: 3800 }
// Why longer: with no motion, the words under the row are the whole notice.
const STILL_STEPS: Steps = { landed: 0, done: 4000 }
export const TEAM_XP_COUNT_MS = 700

/** The gain the row is playing, if any, and the XP left as it counts down. */
export function useTeamXpMotion(xp: TeamXp): { motion: TeamXpMotion | null; left: number } {
  const reduced = usePrefersReducedMotion()
  const previous = useRef(xp)
  const [motion, setMotion] = useState<TeamXpMotion | null>(null)
  const [counted, setCounted] = useState<{ key: number; value: number } | null>(null)

  // Why layout: the poll's new figures must not paint once before the gain starts from the old.
  // A total that falls mid-play ends it rather than leave a phase on screen.
  useLayoutEffect(() => {
    const before = previous.current
    previous.current = xp
    if (before.total === xp.total) {
      return
    }
    const gain = teamXpGainOf(before, xp)
    const still = reduced
    const steps = still ? STILL_STEPS : gain && isTeamLevelUp(gain) ? LEVEL_STEPS : GAIN_STEPS
    const phase = Object.keys(steps)[0] as TeamXpPhase
    setMotion(gain ? { key: Date.now(), gain, phase, still, steps } : null)
  }, [xp, reduced])

  useEffect(() => {
    if (!motion) {
      return
    }
    const order = Object.keys(motion.steps) as (TeamXpPhase | 'done')[]
    const next = order[order.indexOf(motion.phase) + 1]
    const wait = (motion.steps[next] ?? 0) - (motion.steps[motion.phase] ?? 0)
    const timer = setTimeout(
      () => setMotion(next === 'done' ? null : { ...motion, phase: next }),
      wait
    )
    return () => clearTimeout(timer)
  }, [motion])

  const counting = motion?.phase === 'grow' ? motion : null
  const countFrom = counting ? teamXpLeftOf(counting.gain.to) + counting.gain.gained : 0
  useEffect(() => {
    if (!counting) {
      return
    }
    const to = teamXpLeftOf(counting.gain.to)
    const start = performance.now()
    let frame = requestAnimationFrame(function tick(now) {
      // Why clamped: a frame's timestamp can precede the start read here.
      const t = Math.min(1, Math.max(0, (now - start) / TEAM_XP_COUNT_MS))
      const value = Math.round(countFrom + (to - countFrom) * (1 - (1 - t) ** 3))
      setCounted({ key: counting.key, value })
      frame = t < 1 ? requestAnimationFrame(tick) : 0
    })
    return () => cancelAnimationFrame(frame)
  }, [counting, countFrom])

  if (counting) {
    // Why from the old figure: the first frame must not flash the new one before the count.
    return { motion, left: counted?.key === counting.key ? counted.value : countFrom }
  }
  const shown =
    motion && (motion.phase === 'fill' || motion.phase === 'sweep') ? motion.gain.from : xp
  return { motion, left: teamXpLeftOf(shown) }
}

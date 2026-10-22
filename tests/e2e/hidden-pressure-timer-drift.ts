/** Why: one whole-second renderer stall (ORCA-760) lands as a single late tick; starvation
 *  repeats, so the second-worst tick is what separates the two. Fewer than two late ticks
 *  means no second stall, hence 0. */
export function secondWorstLateTimerTickMs(lateTimerTicksMs: readonly number[]): number {
  return [...lateTimerTicksMs].sort((a, b) => b - a)[1] ?? 0
}

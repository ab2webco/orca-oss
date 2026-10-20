export const percentileOf = (values: readonly number[], percentile: number): number => {
  if (values.length === 0) {
    return 0
  }
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((percentile / 100) * sorted.length) - 1
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))] ?? 0
}

export type FrameWindow = { fps: number; frameP50Ms: number; frameP95Ms: number }

export const frameWindowOf = (intervalsMs: readonly number[], windowMs: number): FrameWindow => ({
  fps: Math.round((intervalsMs.length * 1000) / windowMs),
  frameP50Ms: percentileOf(intervalsMs, 50),
  frameP95Ms: percentileOf(intervalsMs, 95)
})

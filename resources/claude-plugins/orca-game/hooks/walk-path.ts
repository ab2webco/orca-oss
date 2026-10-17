// Where the hero stands: walking back and forth across the stage, or resting a third of the way in.

export const CLAWD_TOP = 2
export const SPRITE_WIDTH = 10

export const walkColumn = (width: number, tick: number): number => {
  const span = Math.max(1, width - 10)
  const step = Math.floor(tick / 2) % (span * 2)
  return step < span ? step : span * 2 - step
}

export const restColumnOf = (width: number): number => Math.max(0, Math.floor((width - 10) / 3))

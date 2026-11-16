// The arcade games' seeded randomness: the same seed plays the same run on every surface.

export const arcadeHashOf = (x: number, y: number): number => {
  let h = (x * 374761393 + y * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return (h ^ (h >>> 16)) >>> 0
}

/** The `n`th roll of a run, in [0, 1). */
export const arcadeRollOf = (seed: number, n: number): number => arcadeHashOf(seed, n) / 0x100000000

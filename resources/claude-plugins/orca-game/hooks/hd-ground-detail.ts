import { hash, mix, mod } from './pixel-canvas'
import type { Look } from './scenes/scene-definition'

// What lies in the soil under the walking strip, per scenery: grass and stones in the country,
// a kerb and lane marks in the city, shards among crystals. Every mark is two pixels wide.

const SLOT = 9

/** The soil's detail at ground column `gx`, `depth` rows under the floor, over its grain `soil`; undefined where bare. */
export const hdGroundDetailOf = (
  look: Look,
  gx: number,
  depth: number,
  soil: number
): number | undefined => {
  const slot = Math.floor(gx / SLOT)
  const dx = mod(gx, SLOT) - (hash(slot, 79) % (SLOT - 2))
  const isMark = dx === 0 || dx === 1
  switch (look.scenery ?? 'peaks') {
    case 'skyline':
      // A kerb under the walk, then a dashed lane line.
      if (depth === 1) {
        return mix(soil, 0xffffff, 0.28)
      }
      return depth === 2 && mod(gx, 8) < 4 ? mix(soil, look.snow, 0.45) : undefined
    case 'crystals':
      return isMark && depth >= 1 && hash(slot, 83) % 2 === 0
        ? mix(soil, mix(look.plant, look.snow, 0.35), 0.8)
        : undefined
    case 'peaks':
    case 'meadow':
      // Grass along the top row of soil, stones further down.
      if (depth === 1 && hash(gx >> 1, 89) % 3 !== 0) {
        return mix(soil, mix(look.near, look.plant, 0.4), 0.8)
      }
      return isMark && depth === 2 && hash(slot, 97) % 2 === 0
        ? mix(soil, look.snow, 0.35)
        : undefined
  }
}

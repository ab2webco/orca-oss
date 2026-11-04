import { hash, mod } from './pixel-canvas'
import { hdRoofTopOf } from './scene-hd-depth'
import type { Look } from './scenes/scene-definition'

// How tall hd's far range and hills stand at a world column, per scenery.

/** The far range's height over the ground at far column `x`. */
export const hdFarHeightOf = (look: Look, pixels: number, x: number): number => {
  switch (look.scenery ?? 'peaks') {
    case 'peaks': {
      const i = Math.floor(x / 26)
      let best = 0
      for (let k = i - 1; k <= i + 1; k += 1) {
        const peak = pixels * (0.52 + (hash(k, 5) % 24) / 100)
        best = Math.max(best, peak - Math.abs(x - (k * 26 + (hash(k, 3) % 12))) * 0.75)
      }
      return best
    }
    case 'skyline':
      return mod(x, 7) === 6
        ? pixels * 0.24
        : pixels * (0.36 + (hash(Math.floor(x / 7), 13) % 32) / 100)
    case 'crystals': {
      const i = Math.floor(x / 13)
      let best = 0
      for (let k = i - 1; k <= i + 1; k += 1) {
        const spire = pixels * (0.44 + (hash(k, 19) % 28) / 100)
        best = Math.max(best, spire - Math.abs(x - (k * 13 + (hash(k, 17) % 6))) * 2.2)
      }
      return best
    }
    case 'meadow':
      return pixels * (0.4 + 0.12 * Math.sin(x * 0.07 + 1) + 0.05 * Math.sin(x * 0.19))
  }
}

/** The hills' top row at hill column `mx`; a city's are flat rooftops. */
export const hdMidTopOf = (look: Look, ground: number, pixels: number, mx: number): number =>
  look.scenery === 'skyline'
    ? hdRoofTopOf(ground, pixels, mx)
    : ground - pixels * (0.2 + 0.06 * Math.sin(mx * 0.11 + 2) + 0.03 * Math.sin(mx * 0.29))

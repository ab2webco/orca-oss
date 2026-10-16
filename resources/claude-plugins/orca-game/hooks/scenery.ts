import { hash, mix, mod } from './pixel-canvas'
import type { Look } from './scenes/index'

// The landscape behind Clawd: hills or rooftops with their plants, a far layer, the sun or a signal.
// Skyline, crystals, meadow, antennas, crystals and flowers come from Jucer Orozco's PR #32.

export const GROUND = 9
const PEAK_EVERY = 23
const BUILDING_EVERY = 6

const peakOf = (x: number): { top: number; height: number } => {
  let best = { top: GROUND, height: 0 }
  const index = Math.floor(x / PEAK_EVERY)
  for (let i = index - 1; i <= index + 1; i += 1) {
    const centre = i * PEAK_EVERY + (hash(i, 3) % 10)
    const height = 4 + (hash(i, 5) % 4)
    const top = Math.round(GROUND - 1 - Math.max(0, height - Math.abs(x - centre) * 0.7))
    if (top < best.top) {
      best = { top, height }
    }
  }
  return best
}

const spireOf = (x: number): number => {
  let best = GROUND
  const index = Math.floor(x / 11)
  for (let i = index - 1; i <= index + 1; i += 1) {
    const centre = i * 11 + (hash(i, 17) % 6)
    const height = 4 + (hash(i, 19) % 4)
    best = Math.min(best, Math.round(GROUND - 1 - Math.max(0, height - Math.abs(x - centre) * 1.6)))
  }
  return best
}

const meadowTop = (x: number): number =>
  Math.round(5.6 - 1.1 * Math.sin(x * 0.09 + 1) - 0.5 * Math.sin(x * 0.23))

const hillTop = (x: number): number =>
  Math.max(
    6,
    Math.min(GROUND, Math.round(7.7 - 0.9 * Math.sin(x * 0.17 + 2) - 0.6 * Math.sin(x * 0.37)))
  )

const roofTop = (x: number): number => (hash(Math.floor(x / 9), 11) % 3 === 0 ? 6 : 7)

export const nearTopOf = (look: Look, x: number): number =>
  look.scenery === 'skyline' ? roofTop(x) : hillTop(x)

export const plantPixel = (look: Look, x: number, y: number, top: number): number | undefined => {
  const slot = mod(x, 13)
  if (look.plantKind === 'none' || hash(Math.floor(x / 13), 9) % 3 === 0) {
    return undefined
  }
  const isStem = slot === 6 && y >= top - 3 && y < top
  switch (look.plantKind) {
    case 'tree':
      return (y === top - 3 && slot === 6) ||
        ((y === top - 2 || y === top - 1) && slot >= 5 && slot <= 7)
        ? look.plant
        : undefined
    case 'cactus':
      return isStem || (slot === 7 && y === top - 2) ? look.plant : undefined
    case 'antenna':
      return slot === 6 && y >= top - 2 && y < top ? look.plant : undefined
    case 'crystal':
      return isStem || ((slot === 5 || slot === 7) && y === top - 1) ? look.plant : undefined
    case 'flower':
      return (slot === 3 || slot === 9) && y === top - 1 ? look.plant : undefined
  }
}

export const farPixel = (look: Look, x: number, y: number, tick: number): number | undefined => {
  switch (look.scenery ?? 'peaks') {
    case 'peaks': {
      const peak = peakOf(x)
      if (y < peak.top) {
        return undefined
      }
      const isSnow = y <= peak.top + 1 && peak.top <= 3
      return isSnow ? look.snow : mix(look.far, look.near, (y - peak.top) * 0.06)
    }
    case 'skyline': {
      const top = GROUND - 3 - (hash(Math.floor(x / BUILDING_EVERY), 13) % 5)
      if (mod(x, BUILDING_EVERY) === BUILDING_EVERY - 1 || y < top) {
        return undefined
      }
      const isWindow = y > top && mod(x, 2) === 1 && mod(y, 2) === 0
      const isLit = isWindow && (hash(x, y) + Math.floor(tick / 40)) % 3 === 0
      return isLit ? look.snow : look.far
    }
    case 'crystals': {
      const top = spireOf(x)
      if (y < top) {
        return undefined
      }
      return y === top || mod(x, 5) === 0 ? look.snow : mix(look.far, look.near, (y - top) * 0.07)
    }
    case 'meadow': {
      const top = meadowTop(x)
      return y >= top ? mix(look.far, look.near, (y - top) * 0.1) : undefined
    }
  }
}

// The sun, or a signal: a dark emblem on a lit disc with its beam slanting down to the city.
export const sunPixel = (look: Look, width: number, x: number, y: number): number | undefined => {
  const dx = x - (width - 14)
  const dy = y - 2.5
  const isDisc = dx * dx + dy * dy * 1.4 <= 5
  if (look.isSignal !== true) {
    return isDisc ? look.sun : undefined
  }
  if (isDisc) {
    return Math.abs(dx) <= 1 && Math.abs(dy) <= 0.5 ? 0x1c1f2b : look.sun
  }
  const isBeam = y > 3 && Math.abs(dx - (y - 3) * 0.7) <= 1
  return isBeam ? mix(look.skyBottom, look.sun, 0.35) : undefined
}

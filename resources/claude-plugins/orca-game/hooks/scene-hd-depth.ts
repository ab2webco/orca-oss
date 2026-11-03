import { landInLight } from './hd-daylight'
import { accentApartFromSky, apartFromSky } from './hd-layer-contrast'
import { pushedBackOf } from './hd-readability'
import { hash, mix, mod } from './pixel-canvas'
import type { HdFrame } from './scene-hd-land'
import { skyRowOf } from './scene-hd-sky'
import type { Look, Scenery } from './scenes/scene-definition'

// hd's depth, from a look's own colours: a hazy range behind the far scenery, one landmark per
// scenery standing on the far range, and detail along the hills. Every shape is two pixels thick.

/** The distant range scrolls at a twelfth of the ground's pace, half the far range's. */
export const hdBackShiftOf = (scroll: number): number => Math.floor(scroll / 12)

// Why most of the way to the sky: aerial haze is what reads as distance at this size.
const HAZE = 0.55

/** How tall the distant range stands over the ground at world column `x`. */
export const hdBackHeightOf = (look: Look, pixels: number, x: number): number => {
  switch (look.scenery ?? 'peaks') {
    case 'peaks': {
      const i = Math.floor(x / 53)
      let best = 0
      for (let k = i - 1; k <= i + 1; k += 1) {
        const peak = pixels * (0.7 + (hash(k, 41) % 12) / 100)
        best = Math.max(best, peak - Math.abs(x - (k * 53 + (hash(k, 43) % 20))) * 0.55)
      }
      return best
    }
    case 'skyline': {
      const block = Math.floor(x / 9)
      const isGap = mod(x, 9) >= 5 + (hash(block, 47) % 3)
      return isGap ? pixels * 0.3 : pixels * (0.48 + (hash(block, 53) % 26) / 100)
    }
    case 'crystals': {
      const i = Math.floor(x / 31)
      let best = 0
      for (let k = i - 1; k <= i + 1; k += 1) {
        const spire = pixels * (0.62 + (hash(k, 59) % 16) / 100)
        best = Math.max(best, spire - Math.abs(x - (k * 31 + (hash(k, 61) % 9))) * 1.3)
      }
      return best
    }
    case 'meadow':
      return pixels * (0.38 + 0.05 * Math.sin(x * 0.045) + 0.03 * Math.sin(x * 0.13 + 2))
  }
}

/** The distant range at (x, y), or undefined where the sky shows above it. */
export const hdBackPixel = (frame: HdFrame, x: number, y: number): number | undefined => {
  const { look, ground, pixels } = frame
  const bx = x + hdBackShiftOf(frame.scroll)
  const top = ground - hdBackHeightOf(look, pixels, bx)
  if (y < top) {
    return undefined
  }
  const lit = landInLight(look.far, frame.light, frame.dayLift, look.isNight)
  const far = apartFromSky(pushedBackOf(lit, frame.light), frame.far, y)
  const isCap = look.scenery === 'peaks' && y - top < 2
  const tone = isCap ? mix(far, landInLight(look.snow, frame.light, frame.dayLift), 0.5) : far
  return mix(tone, skyRowOf(frame, y), HAZE)
}

// One landmark per scenery on the far range: `#` its wall, `L` the face that catches the light,
// `w` a window lit after dusk, `d` a doorway, `b` a beacon or glint that blinks, `o` a hub.
// A two-frame landmark turns every MARK_TICKS.
const MARKS: Readonly<Record<Scenery, readonly (readonly string[])[]>> = {
  peaks: [
    [
      'LL.L.....L.LL',
      'LLLL.....LLLL',
      'LLLL.#.#.LLLL',
      'LL#########LL',
      'LLww##L##wwLL',
      'LLww#####wwLL',
      'LL####dd###LL',
      'LL####dd###LL'
    ]
  ],
  skyline: [
    [
      '.bb.',
      '.##.',
      '.##.',
      '.##.',
      'L##.',
      'L###',
      'L###',
      'L###',
      'Lw##',
      'Lw##',
      'L###',
      'L###'
    ],
    ['....', '.##.', '.##.', '.##.', 'L##.', 'L###', 'L###', 'L###', 'Lw##', 'Lw##', 'L###', 'L###']
  ],
  // Why a gap over the plinth: a crystal that floats and bobs reads as no spire of the range.
  crystals: [
    [
      '...........',
      '....LL#....',
      '...LLL##...',
      '..LLLb###..',
      '..LLLb###..',
      '..LLLL###..',
      '...LLL##...',
      '....LL#....',
      '...........',
      '...........',
      '...........',
      '...LL###...',
      '..LLL####..'
    ],
    [
      '....LL#....',
      '...LLL##...',
      '..LLLL###..',
      '..LLLL###..',
      '..LLLL###..',
      '...LLL##...',
      '....LL#....',
      '...........',
      '...........',
      '...........',
      '...........',
      '...LL###...',
      '..LLL####..'
    ]
  ],
  meadow: [
    [
      '.....LL......',
      '.....LL......',
      '.....LL......',
      'LLLLLooLLLLLL',
      '....LooL.....',
      '....L##L.....',
      '....L###.....',
      '...LL###.....',
      '...LL#dd#....',
      '...LL#dd#....'
    ],
    [
      'LL.........LL',
      '.LL.......LL.',
      '..LL.....LL..',
      '....LLooL....',
      '....LooL.....',
      '...LL##L.LL..',
      '..LLL###..LL.',
      '.LLLL###...LL',
      '...LL#dd#....',
      '...LL#dd#....'
    ]
  ]
}

const MARK_EVERY = 160
export const MARK_TICKS = 10

/** Which frame of its landmark a scenery shows at `tick`; one frame, or none, never turns. */
export const hdMarkPhaseOf = (look: Look, tick: number): number =>
  (MARKS[look.scenery ?? 'peaks'].length > 1 ? Math.floor(tick / MARK_TICKS) : 0) % 2

/**
 * The landmark's glyph at far column `fx`, `y`, standing on the range where `heightAt` says;
 * undefined off the landmark or in its transparent cells.
 */
export const hdMarkGlyphOf = (
  look: Look,
  fx: number,
  y: number,
  ground: number,
  tick: number,
  heightAt: (fx: number) => number
): string | undefined => {
  const frames = MARKS[look.scenery ?? 'peaks']
  const rows = frames[hdMarkPhaseOf(look, tick) % frames.length] ?? frames[0] ?? []
  const width = rows[0]?.length ?? 0
  const slot = Math.floor(fx / MARK_EVERY)
  const left = slot * MARK_EVERY + 20 + (hash(slot, 67) % (MARK_EVERY - width - 40))
  const dx = fx - left
  if (dx < 0 || dx >= width) {
    return undefined
  }
  // Why the lowest of its footprint: a landmark on a slope stands on its foundation, never in the air.
  let base = Infinity
  for (let at = left; at < left + width; at += 1) {
    base = Math.min(base, heightAt(at))
  }
  const top = Math.round(ground - base) - rows.length + 1
  const row = rows[Math.min(rows.length - 1, y - top)]
  const glyph = y < top ? undefined : row?.[dx]
  return glyph === undefined || glyph === '.' ? undefined : glyph
}

export const WARM_WINDOW = 0xffd27a
const BEACON = 0xff4a4a

/** The landmark at far column `fx`, `y`, lit like the range it stands on; undefined off it. */
export const hdMarkPixelOf = (
  frame: HdFrame,
  fx: number,
  y: number,
  heightAt: (fx: number) => number
): number | undefined => {
  const { look } = frame
  const glyph = hdMarkGlyphOf(look, fx, y, frame.ground, frame.tick, heightAt)
  if (glyph === undefined) {
    return undefined
  }
  const lit = (color: number): number =>
    landInLight(color, frame.light, frame.dayLift, look.isNight)
  const layer = (color: number): number =>
    apartFromSky(pushedBackOf(lit(color), frame.light), frame.far, y)
  const accent = (color: number): number => accentApartFromSky(color, frame.far, y)
  // Why a pale face on a dark wall: the landmark reads by its own form, not against the rock behind.
  const opening = mix(look.far, 0x000000, 0.62)
  switch (glyph) {
    case 'L':
      return layer(
        look.scenery === 'crystals'
          ? mix(look.plant, look.snow, 0.3)
          : mix(look.far, look.snow, 0.55)
      )
    case 'w':
      return frame.light.night > 0.5 ? accent(WARM_WINDOW) : layer(opening)
    case 'd':
    case 'o':
      return layer(opening)
    case 'b':
      return accent(look.scenery === 'skyline' ? BEACON : lit(look.snow))
    default:
      return layer(mix(look.far, 0x000000, 0.4))
  }
}

/** Detail standing on the hills, `h` pixels above their top at hill column `mx`. */
export const hdHillDetailOf = (look: Look, mx: number, h: number): 'leaf' | 'shard' | undefined => {
  const slot = Math.floor(mx / 7)
  const dx = mod(mx, 7)
  if (h < 0 || hash(slot, 71) % 3 === 0) {
    return undefined
  }
  switch (look.scenery ?? 'peaks') {
    case 'peaks':
      // A pine: a trunk-wide top, a three-wide crown under it.
      return (dx === 3 && h < 4) || (dx >= 2 && dx <= 4 && h < 3) ? 'leaf' : undefined
    case 'meadow':
      return (dx >= 2 && dx <= 5 && h < 1) || (dx >= 3 && dx <= 4 && h < 2) ? 'leaf' : undefined
    case 'crystals':
      return (dx >= 2 && dx <= 3 && h < 3) || (dx === 4 && h < 1) ? 'shard' : undefined
    case 'skyline':
      return undefined
  }
}

/** A city's near rooftops: flat blocks of six columns in place of hills, each its own height. */
export const hdRoofTopOf = (ground: number, pixels: number, mx: number): number =>
  ground - pixels * (0.1 + (hash(Math.floor(mx / 6), 73) % 9) / 100)

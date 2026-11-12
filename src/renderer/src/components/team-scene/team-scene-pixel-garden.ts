import type { TeamSceneSite } from '../../../../shared/team-scene/team-scene-sites'

/** Leaves and fruit come from the scene's own look, so a file scene keeps its palette. */
export type PixelGardenPalette = { leaf: string; fruit: string }

// Scene art, not UI chrome: soil, stakes and crates are the same in every scene.
const SOIL = '#6b4a2f'
const SOIL_DARK = '#4a3220'
const STAKE = '#9c7a4c'
const SACK = '#d8c49a'
const CRATE = '#a0703e'
const CRATE_DARK = '#7a5230'
export const PIXEL_WILT = '#a08a4a'

// Plants stand two pixels apart in a bed seven wide; heights per stage, in scene pixels.
const PLANTS = [-2, 0, 2]
const HEIGHT_AT = [0, 2, 3, 5, 5] as const
// Why lighter: a scene's plant colour is its grass, and leaves drawn in it vanish into it.
const LEAF_LIFT = 0.45

const hexOf = (n: number): string => `#${(n & 0xffffff).toString(16).padStart(6, '0')}`
const lifted = (n: number): number =>
  [16, 8, 0].reduce((out, shift) => {
    const c = (n >> shift) & 0xff
    return out | (Math.round(c + (255 - c) * LEAF_LIFT) << shift)
  }, 0)

/** The garden's colours from a scene look's plant and sun. */
export const gardenPaletteOf = (plant: number, sun: number): PixelGardenPalette => ({
  leaf: hexOf(lifted(plant)),
  fruit: hexOf(sun)
})

type Dot = (col: number, row: number, w: number, h: number, color: string) => void

const dotter =
  (g: CanvasRenderingContext2D, px: number): Dot =>
  (col, row, w, h, color) => {
    g.fillStyle = color
    g.fillRect(col * px, row * px, w * px, h * px)
  }

/** A bed whose bottom row is `row`, centred on column `cx`, grown as far as the member really is. */
export function drawPixelPlot(
  g: CanvasRenderingContext2D,
  cx: number,
  row: number,
  px: number,
  site: TeamSceneSite,
  t: number,
  palette: PixelGardenPalette
): void {
  const dot = dotter(g, px)
  dot(cx - 3, row, 7, 1, SOIL)
  for (const dx of PLANTS) {
    dot(cx + dx, row, 1, 1, SOIL_DARK)
  }
  if (site.stage === 2 || site.stage === 3) {
    dot(cx - 4, row - 4, 1, 4, STAKE)
    dot(cx + 4, row - 4, 1, 4, STAKE)
  }
  const tall = HEIGHT_AT[site.stage]
  const leaf = site.broken ? PIXEL_WILT : palette.leaf
  PLANTS.forEach((dx, i) => {
    if (tall === 0) {
      return
    }
    // Why rounded: a sway of whole pixels keeps the bed on the scene's grid.
    const sway = site.broken ? 0 : Math.round(Math.sin(t * 2.4 + i) * 0.6)
    dot(cx + dx, row - tall, 1, tall, leaf)
    if (tall >= 2) {
      // Why lower when wilted: the leaves droop instead of reaching out.
      const leafRow = site.broken ? row - 1 : row - tall + 1
      dot(cx + dx - 1 + sway, leafRow, 1, 1, leaf)
      dot(cx + dx + 1 + sway, leafRow, 1, 1, leaf)
    }
    if (tall >= 5 && !site.broken) {
      dot(cx + dx - 1, row - 1, 1, 1, leaf)
      dot(cx + dx + 1, row - 1, 1, 1, leaf)
    }
    if (site.stage === 4) {
      dot(cx + dx + sway, row - tall - 1, 1, 1, palette.fruit)
    }
  })
}

/** The seed sack a member carries from, left of its seat. */
export function drawPixelSack(
  g: CanvasRenderingContext2D,
  cx: number,
  row: number,
  px: number
): void {
  const dot = dotter(g, px)
  dot(cx - 1, row - 2, 3, 3, SACK)
  dot(cx, row - 3, 1, 1, SOIL_DARK)
}

/** Harvest crates of merged work along the left edge, oldest first. */
export function drawPixelCrates(
  g: CanvasRenderingContext2D,
  count: number,
  row: number,
  px: number,
  palette: PixelGardenPalette
): void {
  const dot = dotter(g, px)
  for (let i = 0; i < count; i++) {
    const col = 1 + i * 5
    dot(col, row - 2, 4, 3, CRATE)
    dot(col, row - 1, 4, 1, CRATE_DARK)
    dot(col + 1, row - 3, 2, 1, palette.fruit)
  }
}

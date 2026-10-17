import { TILE_COLUMNS, TILE_ROWS, tileBackdropOf } from './fleet-tiles'
import { cellsOf, UPPER_HALF } from './pixel-canvas'
import { advisorFrameOf } from './scene-cast'
import type { AdvisorGesture, SceneAdvisor } from './scenes/index'

// The Panel card's tile for Jev's advisor: its scene pose on a member tile's wall and floor.

export const ADVISOR_TILE_KEY = 'advisor-tile'

const TILE_FLOOR = TILE_ROWS * 2 - 1
// Why column 1: it lines up with the Clawd on the member tiles above.
const LEFT = 1

export const advisorTileGridOf = (
  sprite: SceneAdvisor,
  gesture: AdvisorGesture | null,
  tick: number
): number[][] => {
  const frame = advisorFrameOf(
    { sprite, ...(gesture === null ? {} : { gesture }), age: 0, bubble: '' },
    tick
  )
  const top = TILE_FLOOR - frame.length
  const pixel = (x: number, y: number): number => {
    const glyph = frame[y - top]?.[x - LEFT]
    const color = glyph === undefined || glyph === '.' ? undefined : sprite.colors[glyph]
    return color ?? tileBackdropOf(y)
  }
  const grid: number[][] = []
  for (let row = 0; row < TILE_ROWS; row += 1) {
    for (let x = 0; x < TILE_COLUMNS; x += 1) {
      grid.push([UPPER_HALF, pixel(x, row * 2), pixel(x, row * 2 + 1)])
    }
  }
  return grid
}

export const advisorTileCellsOf = (...args: Parameters<typeof advisorTileGridOf>): string =>
  cellsOf(advisorTileGridOf(...args))

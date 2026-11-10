import { teamSceneScaleAt } from '../../../../shared/team-scene/team-scene-motion'
import {
  PILE_FROM_SEAT_X,
  SITE_FROM_SEAT_X,
  type TeamSceneSite,
  type TeamSceneSiteStage
} from '../../../../shared/team-scene/team-scene-sites'
import type { TeamSceneFrame } from './team-scene-painter'

// Scene art, not UI chrome: the Figures style paints its own stone, wood and cloth.
const STONE = '#8f8a82'
const STONE_DARK = '#6c675f'
const WOOD = '#7a5532'
const ROOF = '#5a3a5e'
export const CASTLE_BANNER = '#c8414a'
export const CASTLE_RUBBLE = '#5d5851'

const BLOCK_W = 6
const BLOCK_H = 4
const COLUMNS = 3
// Courses of stone each stage stands at: foundation, walls, scaffold, nearly done, finished.
const COURSES: Record<TeamSceneSiteStage, number> = { 0: 1, 1: 3, 2: 5, 3: 7, 4: 8 }

function drawCourses(g: CanvasRenderingContext2D, courses: number, skipTop: boolean): void {
  for (let row = 0; row < courses; row++) {
    const stagger = row % 2 ? BLOCK_W / 2 : 0
    for (let col = 0; col < COLUMNS; col++) {
      if (skipTop && row === courses - 1 && col === COLUMNS - 1) {
        continue
      }
      g.fillStyle = (row + col) % 3 === 0 ? STONE_DARK : STONE
      const x = -((COLUMNS * BLOCK_W) / 2) + col * BLOCK_W + stagger - (row % 2 ? BLOCK_W / 4 : 0)
      g.fillRect(x, -(row + 1) * BLOCK_H, BLOCK_W - 0.6, BLOCK_H - 0.6)
    }
  }
}

function drawScaffold(g: CanvasRenderingContext2D, height: number): void {
  g.fillStyle = WOOD
  const half = (COLUMNS * BLOCK_W) / 2 + 2
  g.fillRect(-half - 1, -height - 4, 1.4, height + 4)
  g.fillRect(half, -height - 4, 1.4, height + 4)
  g.fillRect(-half - 1, -height * 0.55, half * 2 + 2.4, 1.2)
  g.fillRect(-half - 1, -height - 2, half * 2 + 2.4, 1.2)
}

function drawTop(g: CanvasRenderingContext2D, height: number, t: number): void {
  const half = (COLUMNS * BLOCK_W) / 2
  g.fillStyle = STONE_DARK
  for (let i = 0; i < 3; i++) {
    g.fillRect(-half + i * 7, -height - 3, 4, 3)
  }
  g.fillStyle = ROOF
  g.beginPath()
  g.moveTo(-half - 1, -height - 3)
  g.lineTo(0, -height - 15)
  g.lineTo(half + 1, -height - 3)
  g.closePath()
  g.fill()
  g.fillStyle = WOOD
  g.fillRect(-0.6, -height - 26, 1.2, 12)
  g.fillStyle = CASTLE_BANNER
  g.beginPath()
  g.moveTo(0.6, -height - 26)
  for (let i = 0; i <= 4; i++) {
    g.lineTo(0.6 + i * 2.2, -height - 26 + Math.sin(t * 4 - i * 0.9) * 1.2)
  }
  for (let i = 4; i >= 0; i--) {
    g.lineTo(0.6 + i * 2.2, -height - 21 + Math.sin(t * 4 - i * 0.9) * 1.2)
  }
  g.closePath()
  g.fill()
}

/** A stone tower at `x, y` (its base), `s` scene scale, raised as far as the member really is. */
export function drawCastleSite(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  site: TeamSceneSite,
  t: number
): void {
  g.save()
  g.translate(x, y)
  g.scale(s, s)
  const courses = COURSES[site.stage]
  const height = courses * BLOCK_H
  drawCourses(g, courses, site.broken)
  if (site.stage === 2 || site.stage === 3) {
    drawScaffold(g, height)
  }
  if (site.stage === 4) {
    drawTop(g, height, t)
  }
  if (site.broken) {
    // Why on the ground beside it: the missing top stone reads as fallen, not as unbuilt.
    g.fillStyle = CASTLE_RUBBLE
    g.fillRect(COLUMNS * BLOCK_W * 0.6, -3, 4, 3)
    g.fillRect(COLUMNS * BLOCK_W * 0.6 + 5, -2, 3, 2)
    g.strokeStyle = CASTLE_RUBBLE
    g.lineWidth = 0.8
    g.beginPath()
    g.moveTo(2, -height + 1)
    g.lineTo(0, -height * 0.6)
    g.lineTo(3, -height * 0.3)
    g.stroke()
  }
  g.restore()
}

/** The stones a member carries from, left of its seat. */
export function drawCastlePile(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  g.save()
  g.translate(x, y)
  g.scale(s, s)
  g.fillStyle = STONE
  g.fillRect(-7, -4, 6, 4)
  g.fillRect(0, -4, 6, 4)
  g.fillStyle = STONE_DARK
  g.fillRect(-4, -8, 6, 4)
  g.restore()
}

/** Every seat's pile and tower plus the trophies, for any style that draws in scene px. */
export function drawCastleBuilds(
  g: CanvasRenderingContext2D,
  f: Pick<TeamSceneFrame, 'width' | 'height' | 't' | 'sites' | 'trophies'>,
  feetY: (depth: number, h: number) => number
): void {
  drawCastleTrophies(g, f.trophies.length, f.width, feetY(0, f.height) - 14, f.t)
  for (const site of f.sites) {
    const s = teamSceneScaleAt(site.spot.depth)
    const y = feetY(site.spot.depth, f.height)
    const seat = site.spot.x - SITE_FROM_SEAT_X
    drawCastlePile(g, (seat - PILE_FROM_SEAT_X) * f.width, y, s)
    drawCastleSite(g, site.spot.x * f.width, y, s, site, f.t)
  }
}

/** Finished towers of merged work along the far hills, newest on the right. */
export function drawCastleTrophies(
  g: CanvasRenderingContext2D,
  count: number,
  w: number,
  y: number,
  t: number
): void {
  for (let i = 0; i < count; i++) {
    drawCastleSite(g, w * (0.04 + i * 0.07), y, 0.42, { stage: 4, broken: false }, t + i)
  }
}

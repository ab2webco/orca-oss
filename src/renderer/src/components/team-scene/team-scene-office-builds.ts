import { teamSceneScaleAt } from '../../../../shared/team-scene/team-scene-motion'
import {
  PILE_FROM_SEAT_X,
  SITE_FROM_SEAT_X,
  type TeamSceneSite,
  type TeamSceneSiteStage
} from '../../../../shared/team-scene/team-scene-sites'
import type { TeamSceneFrame } from './team-scene-painter'

// Scene art, not UI chrome: the board, notes and tray are office props.
const FRAME = '#59606b'
const BOARD = '#eef1f4'
const RULE = '#c3c9d1'
const TRAY = '#3b4048'
const PAPER = '#f6f3ea'
export const OFFICE_NOTE = '#ffd86b'
export const OFFICE_STAR = '#ffc23a'

const BOARD_W = 36
const BOARD_H = 24
const COLUMNS = [-12, 0, 12]
// Notes in to do, doing and done at each stage: the board fills toward done as the PR lands.
const NOTES: Record<TeamSceneSiteStage, [number, number, number]> = {
  0: [0, 0, 0],
  1: [3, 0, 0],
  2: [1, 1, 1],
  3: [0, 1, 2],
  4: [0, 0, 3]
}
// Above the monitor, so the desk and its sitter never cover it.
const ABOVE_DESK_PX = 58
const SEAT_TO_BOARD_PX = 22
const BOARD_SCALE = 1.2

function drawStar(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.fillStyle = OFFICE_STAR
  g.beginPath()
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 ? r * 0.45 : r
    const angle = (i * Math.PI) / 5 - Math.PI / 2
    g.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius)
  }
  g.closePath()
  g.fill()
}

/** A task board whose bottom middle is `x, y`, filled as far as the member really is. */
export function drawOfficeBoard(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  site: TeamSceneSite,
  t: number,
  attention: string
): void {
  g.save()
  g.translate(x, y)
  g.scale(s, s)
  g.fillStyle = FRAME
  g.fillRect(-BOARD_W / 2 - 1, -BOARD_H - 1, BOARD_W + 2, BOARD_H + 2)
  g.fillStyle = BOARD
  g.fillRect(-BOARD_W / 2, -BOARD_H, BOARD_W, BOARD_H)
  g.fillStyle = RULE
  g.fillRect(-6.5, -BOARD_H + 2, 0.6, BOARD_H - 4)
  g.fillRect(5.9, -BOARD_H + 2, 0.6, BOARD_H - 4)
  NOTES[site.stage].forEach((count, column) => {
    for (let i = 0; i < count; i++) {
      g.fillStyle = OFFICE_NOTE
      g.fillRect(COLUMNS[column]! - 4, -BOARD_H + 3 + i * 5, 8, 3.6)
    }
  })
  if (site.broken) {
    // Why blinking: a red card that pulses reads as a failure being looked at, not a decoration.
    g.globalAlpha = 0.6 + 0.4 * Math.abs(Math.sin(t * 3))
    g.fillStyle = attention
    g.fillRect(COLUMNS[1]! - 4, -6, 8, 3.6)
    g.globalAlpha = 1
  }
  if (site.stage === 4) {
    drawStar(g, BOARD_W / 2 - 4, -BOARD_H + 4, 3.4)
  }
  g.restore()
}

/** The paper tray a member fetches from, left of its seat. */
export function drawOfficeTray(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  g.save()
  g.translate(x, y)
  g.scale(s, s)
  g.fillStyle = TRAY
  g.fillRect(-6, -6, 12, 6)
  g.fillStyle = PAPER
  g.fillRect(-5, -8, 10, 2)
  g.restore()
}

/** Framed stars of merged work along the top of the window wall, oldest first. */
export function drawOfficePlaques(
  g: CanvasRenderingContext2D,
  count: number,
  w: number,
  y: number
): void {
  for (let i = 0; i < count; i++) {
    const x = w * (0.04 + i * 0.06)
    g.fillStyle = FRAME
    g.fillRect(x - 7, y, 14, 14)
    g.fillStyle = BOARD
    g.fillRect(x - 6, y + 1, 12, 12)
    drawStar(g, x, y + 7, 4)
  }
}

/** Every seat's tray and board plus the plaques, in the image painter's stage px. */
export function drawOfficeBuilds(
  g: CanvasRenderingContext2D,
  f: Pick<TeamSceneFrame, 'width' | 'height' | 't' | 'sites' | 'trophies'>,
  feetY: (depth: number, h: number) => number,
  attention: string
): void {
  drawOfficePlaques(g, f.trophies.length, f.width, 4)
  for (const site of f.sites) {
    const s = teamSceneScaleAt(site.spot.depth)
    const y = feetY(site.spot.depth, f.height)
    const seat = (site.spot.x - SITE_FROM_SEAT_X) * f.width
    drawOfficeTray(g, seat - PILE_FROM_SEAT_X * f.width, y, s)
    const boardX = seat + SEAT_TO_BOARD_PX * s
    drawOfficeBoard(g, boardX, y - ABOVE_DESK_PX * s, s * BOARD_SCALE, site, f.t, attention)
  }
}

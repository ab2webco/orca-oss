import type { TeamSceneMemberInput } from '../../../../shared/team-scene/team-scene-types'
import * as THREE from 'three'
import type { Office3dScreen } from '../../../../shared/team-scene/team-office3d-actions'
import type { TeamSceneSite } from '../../../../shared/team-scene/team-scene-sites'
import { drawDeskScreen } from './team-scene-desk-screens'
import { drawOfficeBoard } from './team-scene-office-builds'
import { drawOfficeHoldScreen } from './team-scene-office-hold'
import { OFFICE_SCREEN_OFF } from './team-scene-office-painter'
import { drawOfficeVirus } from './team-scene-office-virus'
import type { TeamSceneStatusColors } from './team-scene-painter-marks'

// Why the 2D Office's own drawings: a monitor, hold screen, red-CI bug and task board read the
// same in both Offices, so Low resources and Illustrated never disagree about a member (ORCA-1302).

const ON = '#0f1826'
const CODE = ['#7fb4ff', '#a8b4c8']

/** A canvas a mesh shows; `redraw` repaints it and flags the texture. */
export type Office3dCanvas = { tex: THREE.CanvasTexture; redraw: (paint: Paint) => void }
type Paint = (g: CanvasRenderingContext2D, w: number, h: number) => void

/** Null without a 2D canvas (tests, a blocked context): the mesh is simply left out. */
export function office3dCanvas(w: number, h: number): Office3dCanvas | null {
  const c = typeof document === 'undefined' ? null : document.createElement('canvas')
  const g = c?.getContext('2d')
  if (!c || !g) {
    return null
  }
  c.width = w
  c.height = h
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return {
    tex,
    redraw: (paint) => {
      g.clearRect(0, 0, w, h)
      paint(g, w, h)
      tex.needsUpdate = true
    }
  }
}

function code(g: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const [ux, uy] = [w / 28, h / 18]
  for (let i = 0; i < 6; i++) {
    const n = (Math.floor(t * 3) + i * 3) % 7
    g.fillStyle = CODE[i % 2]!
    g.fillRect((2.5 + (n % 3) * 1.5) * ux, (2 + i * 2.5) * uy, (6 + ((n * 11) % 15)) * ux, 1.3 * uy)
  }
}

/** A resting member's screen saver: a dim card drifting slowly, so the desk reads as idle. */
function idle(g: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const [ux, uy] = [w / 28, h / 18]
  const x = 4 + ((Math.sin(t * 0.5) + 1) / 2) * 16
  const y = 3 + ((Math.cos(t * 0.37) + 1) / 2) * 9
  g.fillStyle = '#2b3650'
  g.fillRect(x * ux, y * uy, 6 * ux, 4 * uy)
}

/** Paints a desk's monitor: its desk, a hold's screen, code, idle or off, with the bug on top. */
export function paintOffice3dScreen(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  screen: Office3dScreen,
  virus: boolean,
  t: number,
  colors: TeamSceneStatusColors
): void {
  const rect = { x: 0, y: 0, width: w, height: h }
  g.fillStyle = screen.kind === 'off' ? OFFICE_SCREEN_OFF : ON
  g.fillRect(0, 0, w, h)
  if (screen.kind === 'desk') {
    drawDeskScreen(g, rect, screen.desk, t)
  } else if (screen.kind === 'hold') {
    drawOfficeHoldScreen(g, rect, screen.hold, t, colors)
  } else if (screen.kind === 'code') {
    code(g, w, h, t)
  } else if (screen.kind === 'idle') {
    idle(g, w, h, t)
  }
  if (virus) {
    drawOfficeVirus(g, rect, t)
  }
}

/** Paints the task board over a desk; null paints another session's or a free desk's blank one. */
export function paintOffice3dBoard(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  site: TeamSceneSite | null,
  t: number,
  attention: string
): void {
  const s = w / 38
  drawOfficeBoard(g, w / 2, h - s, s, site ?? { stage: 0, broken: false }, t, attention)
}

const tileOf = (m: TeamSceneMemberInput, reachable: boolean, c: TeamSceneStatusColors): string =>
  !reachable || m.away
    ? '#4b5563'
    : m.activity === 'needsYou'
      ? c.attention
      : m.activity === 'done'
        ? c.done
        : m.activity === 'blocked' || m.hold
          ? c.risk
          : c.working

/** The control room's video wall: one tile per member of its floor, in Orca's status colours. */
export function paintOffice3dWall(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  floorMembers: readonly TeamSceneMemberInput[],
  reachable: boolean,
  c: TeamSceneStatusColors,
  t: number
): void {
  g.fillStyle = '#0b1220'
  g.fillRect(0, 0, w, h)
  const cols = 8,
    tw = 42,
    th = 22,
    gap = 6
  for (const [k, m] of floorMembers.slice(0, 40).entries()) {
    const fill = tileOf(m, reachable, c)
    // Why a pulse on the asker's tile only: the wall says who needs the user at a glance.
    g.globalAlpha = fill === c.attention ? 0.65 + 0.35 * Math.abs(Math.sin(t * 3)) : 1
    g.fillStyle = fill
    g.fillRect(14 + (k % cols) * (tw + gap), 20 + Math.floor(k / cols) * (th + gap), tw, th)
  }
  g.globalAlpha = 1
  g.strokeStyle = '#7fb4ff'
  g.lineWidth = 2
  g.beginPath()
  for (let q = 0; q <= 40; q++) {
    const y = h - 16 - 16 * (0.5 + 0.5 * Math.sin(q * 0.55 + t * 0.8))
    if (q) {
      g.lineTo(14 + q * 9.3, y)
    } else {
      g.moveTo(14, y)
    }
  }
  g.stroke()
}

const TV_OFF = '#0b0f18'

/** The lobby TV: dark with nobody at the console, else a side-scroller running under the player. */
export function paintOffice3dTv(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  playing: boolean,
  t: number
): void {
  g.fillStyle = playing ? '#5ab4f0' : TV_OFF
  g.fillRect(0, 0, w, h)
  if (!playing) {
    return
  }
  const u = h / 14
  const ground = h - 3 * u
  g.fillStyle = '#3f9b5a'
  for (let i = -1; i < 5; i++) {
    const x = i * w * 0.32 - ((t * 8 * u) % (w * 0.32))
    g.fillRect(x, ground - 2 * u, w * 0.22, 2 * u)
  }
  g.fillStyle = '#b5713a'
  g.fillRect(0, ground, w, 3 * u)
  g.fillStyle = '#8a5229'
  for (let x = -((t * 20 * u) % (2 * u)); x < w; x += 2 * u) {
    g.fillRect(x, ground + u, u, u)
  }
  g.fillStyle = '#f2c94c'
  for (let i = 0; i < 4; i++) {
    const x = w - ((t * 20 * u + i * 5 * u) % (w + 2 * u))
    g.fillRect(x, ground - 5 * u, u, u)
  }
  // Why a hop every 0.8 s: the player is clearly playing, not watching a still screen.
  const hop = Math.abs(Math.sin((t * Math.PI) / 0.8)) * 3 * u
  g.fillStyle = '#e04848'
  g.fillRect(w * 0.25, ground - 2 * u - hop, 1.5 * u, 2 * u)
}

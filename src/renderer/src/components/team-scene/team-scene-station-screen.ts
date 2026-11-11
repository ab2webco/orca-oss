import type { TeamScenePlay, TeamScenePose } from '../../../../shared/team-scene/team-scene-types'

// V28's desk screens (drawDesk): code while working, amber on a question, green once done.
// 'fail': the worker's PR has red CI; its lines take the theme's attention tone.
// 'game': a resting member plays a tiny runner on its own screen.
type ScreenState = 'code' | 'ask' | 'ok' | 'off' | 'fail' | 'game'

const BACKGROUND: Record<ScreenState, string> = {
  code: '#0f1826',
  ask: '#3a2d10',
  ok: '#10352a',
  off: '#0a0c10',
  fail: '#2a1012',
  game: '#16112b'
}
const LINE: Record<Exclude<ScreenState, 'off' | 'fail' | 'game'>, string> = {
  code: '#7fb4ff',
  ask: '#ffd24a',
  ok: '#4ade80'
}
const TEXT = '#a8b4c8'
const LINES = 5

const SCREEN_OF: Partial<Record<TeamScenePose, ScreenState>> = {
  work: 'code',
  raise: 'ask',
  done: 'ok'
}

/** The screen of a desk whose worker holds `pose`; null when nobody sits there. */
export function stationScreenStateOf(
  pose: TeamScenePose | null,
  failing = false,
  play?: TeamScenePlay
): ScreenState {
  if (failing) {
    return 'fail'
  }
  if (play === 'game') {
    return 'game'
  }
  return (pose && SCREEN_OF[pose]) ?? 'off'
}

// A runner in 28 x 18 screen units: it hops over blocks scrolling in from the right.
function drawGame(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  ux: number,
  uy: number,
  t: number
): void {
  g.fillStyle = '#7fb4ff'
  g.fillRect(x + 1 * ux, y + 15 * uy, 26 * ux, 0.8 * uy)
  const block = 27 - ((t * 10) % 30)
  g.fillStyle = '#ff7ab6'
  g.fillRect(x + block * ux, y + 12 * uy, 2 * ux, 3 * uy)
  const hop = Math.abs(Math.sin(t * Math.PI * 0.66)) * 7
  g.fillStyle = '#ffd24a'
  g.fillRect(x + 6 * ux, y + (12 - hop) * uy, 3 * ux, 3 * uy)
  g.fillStyle = '#4ade80'
  g.fillRect(x + 2 * ux, y + 2 * uy, (2 + (Math.floor(t) % 6)) * ux, 1.2 * uy)
}

/** Fills `rect` (stage px) as V28 does; only code scrolls, so a done desk holds still. */
export function drawStationScreen(
  g: CanvasRenderingContext2D,
  rect: { x: number; y: number; width: number; height: number },
  state: ScreenState,
  t: number,
  attention = '#e5484d'
): void {
  g.fillStyle = BACKGROUND[state]
  g.fillRect(rect.x, rect.y, rect.width, rect.height)
  if (state === 'off') {
    return
  }
  // V28's lines in its 28 x 18 screen units.
  const ux = rect.width / 28
  const uy = rect.height / 18
  if (state === 'game') {
    drawGame(g, rect.x, rect.y, ux, uy, t)
    return
  }
  const step = state === 'code' ? Math.floor(t * 3) : 0
  const line = state === 'fail' ? attention : LINE[state]
  for (let i = 0; i < LINES; i++) {
    const n = (step + i * 3) % 7
    g.fillStyle = i % 2 ? line : TEXT
    g.fillRect(
      rect.x + (1.5 + (n % 3) * 2) * ux,
      rect.y + (1.5 + i * 3.3) * uy,
      (6 + ((n * 11) % 16)) * ux,
      1.4 * uy
    )
  }
}

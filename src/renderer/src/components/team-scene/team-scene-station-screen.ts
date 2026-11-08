import type { TeamScenePose } from '../../../../shared/team-scene/team-scene-types'

// V28's desk screens (drawDesk): code while working, amber on a question, green once done.
type ScreenState = 'code' | 'ask' | 'ok' | 'off'

const BACKGROUND: Record<ScreenState, string> = {
  code: '#0f1826',
  ask: '#3a2d10',
  ok: '#10352a',
  off: '#0a0c10'
}
const LINE: Record<Exclude<ScreenState, 'off'>, string> = {
  code: '#7fb4ff',
  ask: '#ffd24a',
  ok: '#4ade80'
}
const TEXT = '#a8b4c8'
const LINES = 5

/** The screen of a desk whose worker holds `pose`; null when nobody sits there. */
export function stationScreenStateOf(pose: TeamScenePose | null): ScreenState {
  switch (pose) {
    case 'work':
      return 'code'
    case 'raise':
      return 'ask'
    case 'done':
      return 'ok'
    default:
      return 'off'
  }
}

/** Fills `rect` (stage px) as V28 does; only code scrolls, so a done desk holds still. */
export function drawStationScreen(
  g: CanvasRenderingContext2D,
  rect: { x: number; y: number; width: number; height: number },
  state: ScreenState,
  t: number
): void {
  g.fillStyle = BACKGROUND[state]
  g.fillRect(rect.x, rect.y, rect.width, rect.height)
  if (state === 'off') {
    return
  }
  // V28's lines in its 28 x 18 screen units.
  const ux = rect.width / 28
  const uy = rect.height / 18
  const step = state === 'code' ? Math.floor(t * 3) : 0
  for (let i = 0; i < LINES; i++) {
    const n = (step + i * 3) % 7
    g.fillStyle = i % 2 ? LINE[state] : TEXT
    g.fillRect(
      rect.x + (1.5 + (n % 3) * 2) * ux,
      rect.y + (1.5 + i * 3.3) * uy,
      (6 + ((n * 11) % 16)) * ux,
      1.4 * uy
    )
  }
}

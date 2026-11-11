import { drawOfficeVirus } from './team-scene-office-virus'
import { SITE_FROM_SEAT_X } from '../../../../shared/team-scene/team-scene-sites'
import type {
  TeamScenePlay,
  TeamScenePose,
  TeamSceneSpot
} from '../../../../shared/team-scene/team-scene-types'

// V28's desk screens (drawDesk): code while working, amber on a question, green once done.
// 'fail': the worker's PR has red CI; its lines take the theme's attention tone.
// 'game': a resting member plays a tiny runner on its own screen.
// 'away': the member's session is gone or never started; dark, with a small warning mark.
type ScreenRect = { x: number; y: number; width: number; height: number }
type ScreenState = 'code' | 'ask' | 'ok' | 'off' | 'fail' | 'game' | 'away'

const BACKGROUND: Record<ScreenState, string> = {
  code: '#0f1826',
  ask: '#3a2d10',
  ok: '#10352a',
  off: '#0a0c10',
  fail: '#2a1012',
  game: '#16112b',
  away: '#0a0c10'
}
const LINE: Record<Exclude<ScreenState, 'off' | 'fail' | 'game' | 'away'>, string> = {
  code: '#7fb4ff',
  ask: '#ffd24a',
  ok: '#4ade80'
}
const TEXT = '#a8b4c8'
export const STATION_SCREEN_GLOW = '#9cc4ff'
const BOOT_SECONDS = 1.4
const LINES = 5

const SCREEN_OF: Partial<Record<TeamScenePose, ScreenState>> = {
  work: 'code',
  raise: 'ask',
  done: 'ok'
}

/** The screen of a desk whose worker holds `pose`; null when nobody sits there. */
export function stationScreenStateOf(
  worker: { pose: TeamScenePose; play?: TeamScenePlay; away?: true } | null,
  failing = false
): ScreenState {
  // Why first: nobody is there to fix red CI, so the screen says the session is gone.
  if (worker?.away) {
    return 'away'
  }
  if (failing) {
    return 'fail'
  }
  if (worker?.play === 'game') {
    return 'game'
  }
  return (worker && SCREEN_OF[worker.pose]) ?? 'off'
}

// A small warning triangle, centred, in the card's attention colour.
function drawAway(g: CanvasRenderingContext2D, rect: ScreenRect, attention: string): void {
  const s = Math.min(rect.width, rect.height) * 0.42
  const [cx, cy] = [rect.x + rect.width / 2, rect.y + rect.height / 2]
  g.beginPath()
  g.moveTo(cx, cy - s / 2)
  g.lineTo(cx + s * 0.58, cy + s / 2)
  g.lineTo(cx - s * 0.58, cy + s / 2)
  g.closePath()
  g.fillStyle = attention
  g.fill()
  g.fillStyle = BACKGROUND.away
  g.fillRect(cx - s * 0.05, cy - s * 0.18, s * 0.1, s * 0.36)
  g.fillRect(cx - s * 0.05, cy + s * 0.27, s * 0.1, s * 0.1)
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
  {
    attention = '#e5484d',
    virus = false,
    boot
  }: {
    attention?: string
    /** Office's bug over a failing screen. */
    virus?: boolean
    /** 0 to 1 while a member who just sat down boots its screen; absent once booted. */
    boot?: number
  } = {}
): void {
  g.fillStyle = BACKGROUND[state]
  g.fillRect(rect.x, rect.y, rect.width, rect.height)
  if (boot !== undefined) {
    // Why a glow that fades: a screen waking up greets the member without a burst over the desk.
    g.globalAlpha = (1 - boot) * 0.55
    g.fillStyle = STATION_SCREEN_GLOW
    g.fillRect(rect.x, rect.y, rect.width, rect.height)
    g.globalAlpha = 1
  }
  if (state === 'off') {
    return
  }
  if (state === 'away') {
    drawAway(g, rect, attention)
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
  const shown = boot === undefined ? LINES : Math.ceil(boot * LINES)
  for (let i = 0; i < shown; i++) {
    const n = (step + i * 3) % 7
    g.fillStyle = i % 2 ? line : TEXT
    g.fillRect(
      rect.x + (1.5 + (n % 3) * 2) * ux,
      rect.y + (1.5 + i * 3.3) * uy,
      (6 + ((n * 11) % 16)) * ux,
      1.4 * uy
    )
  }
  if (virus && state === 'fail') {
    drawOfficeVirus(g, rect, t)
  }
}

/** Whether the desk at `spot` has a broken site: its member's PR has red CI. */
export function stationFailingAt(
  f: { width: number; sites: readonly { broken: boolean; spot: TeamSceneSpot }[] },
  spot: TeamSceneSpot,
  within: number
): boolean {
  // Why by spot: a site sits a fixed offset right of its seat (siteSpotOf).
  return f.sites.some(
    (site) => site.broken && Math.abs((site.spot.x - SITE_FROM_SEAT_X - spot.x) * f.width) < within
  )
}

/** Screens booting for members who just sat down; their welcome replaces the burst. */
export function createStationBoots() {
  const started = new Map<string, number>()
  return {
    /** The effects left once each welcome has started its member's boot. */
    take: <E extends { kind: string; key?: string; reason?: string }>(
      effects: E[],
      t: number
    ): E[] =>
      effects.filter((e) => {
        if (e.kind === 'burst' && e.reason === 'welcome' && e.key) {
          started.set(e.key, t)
          return false
        }
        return true
      }),
    progressOf: (key: string | undefined, t: number): number | undefined => {
      const at = key === undefined ? undefined : started.get(key)
      if (at === undefined || t - at >= BOOT_SECONDS) {
        if (key !== undefined) {
          started.delete(key)
        }
        return undefined
      }
      return Math.max(0, (t - at) / BOOT_SECONDS)
    }
  }
}

/** The desk art's screen in stage px, for a desk drawn at `left, top` with `px` per art px. */
export const stationScreenRectAt = (
  screen: ScreenRect,
  left: number,
  top: number,
  px: number
): ScreenRect => ({
  x: left + screen.x * px,
  y: top + screen.y * px,
  width: screen.width * px,
  height: screen.height * px
})

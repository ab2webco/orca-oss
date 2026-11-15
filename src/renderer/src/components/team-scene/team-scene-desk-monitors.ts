import type { TeamSceneActor } from '../../../../shared/team-scene/team-scene-types'
import type { TeamSceneStatusColors } from './team-scene-painter-marks'
import {
  createStationBoots,
  drawStationScreen,
  type stationScreenStateOf
} from './team-scene-station-screen'
import { createVerdictFlights, drawVerdictScreen } from './team-scene-verdict-flights'

type Rect = { x: number; y: number; width: number; height: number }

/**
 * The desks' monitors and their moments: a boot for a member who sits down, a green CI pass, and
 * Jev's decision landing on the judged member's screen once its token arrives (ORCA-1218).
 */
export function createDeskMonitors(
  feetY: (depth: number, h: number) => number,
  colors: TeamSceneStatusColors
) {
  const boots = createStationBoots()
  const verdicts = createVerdictFlights(feetY, colors)
  return {
    /** The effects left once the screen moments have taken theirs. */
    take: boots.take,
    /** Starts the tokens for this frame's decisions, from where the advisor stands. */
    start: verdicts.start,
    /** Draws the tokens in flight, over the scene. */
    drawFlights: verdicts.draw,
    /** Fills the monitor at `rect` for whoever sits there. */
    drawScreen: (
      g: CanvasRenderingContext2D,
      rect: Rect,
      state: ReturnType<typeof stationScreenStateOf>,
      worker: Pick<TeamSceneActor, 'key' | 'desk' | 'hold'> | undefined,
      t: number,
      virus: boolean
    ): void => {
      const key = worker?.key
      drawStationScreen(g, rect, state, t, {
        ...colors,
        virus,
        boot: boots.progressOf(key, t),
        desk: worker?.desk,
        hold: worker?.hold,
        green: boots.passOf(key, t)
      })
      // Why not over away or held screens: they say why nobody can act on a decision.
      const verdict = state === 'away' || state === 'hold' ? undefined : verdicts.landedOn(key, t)
      if (verdict) {
        drawVerdictScreen(g, rect, verdict)
      }
    },
    clear: verdicts.clear
  }
}

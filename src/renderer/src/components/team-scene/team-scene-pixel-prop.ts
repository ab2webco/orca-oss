import type { SceneProp } from '../../../../../resources/claude-plugins/orca-game/hooks/scenes/scene-definition'
import type { TeamSceneActor } from '../../../../shared/team-scene/team-scene-types'

// V28's tool and paper tones, and its swing: every 1.15 s, easing out over about 0.43 s.
const TOOL = '#e8eef4'
const PAPER = '#f4e6c0'
const SWING_SECONDS = 1.15
const SWING_FADE = 2.3

type Dot = (dx: number, dy: number, w: number, h: number, color: string) => void

const hex = (color: number): string => `#${(color & 0xffffff).toString(16).padStart(6, '0')}`

function drawSword(dot: Dot, a: TeamSceneActor, t: number, swing: number): void {
  if (a.pose === 'raise' || a.pose === 'wave' || a.pose === 'cheer') {
    dot(0, -6 + (Math.floor(t * 6) % 2), 1, 4, TOOL)
  } else if (a.pose === 'done') {
    // Why shouldered: a raised tool already means asking the user.
    dot(-1, -3, 1, 1, TOOL)
    dot(-2, -4, 1, 1, TOOL)
    dot(-3, -5, 1, 1, TOOL)
  } else if (swing > 0.6) {
    dot(1, -4, 1, 4, TOOL)
  } else if (swing > 0.3) {
    dot(1, -1, 1, 1, TOOL)
    dot(2, -2, 1, 1, TOOL)
    dot(3, -3, 1, 1, TOOL)
  } else if (swing > 0) {
    dot(1, 1, 4, 1, TOOL)
  } else {
    // Why held between swings: a worker at rest must still read apart from a resting member.
    dot(1, -1, 1, 3, TOOL)
  }
}

// Why lifted, not turned: a scene's art is drawn as written, so it swings up and down instead.
function drawSprite(
  dot: Dot,
  a: TeamSceneActor,
  t: number,
  swing: number,
  sprite: Exclude<SceneProp, 'sword'>
): void {
  const raised = a.pose === 'raise' || a.pose === 'wave' || a.pose === 'cheer'
  const lift = raised ? -4 + (Math.floor(t * 6) % 2) : swing > 0.6 ? -2 : swing > 0.3 ? -1 : 0
  const bottom = 1 + lift - sprite.rows.length + 1
  sprite.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = row[x] === '.' ? undefined : sprite.colors[row[x]!]
      if (color !== undefined) {
        dot(1 + x, bottom + y, 1, 1, hex(color))
      }
    }
  })
}

/**
 * What an actor holds, in scene pixels from its middle (`cx`, `hy`): a paper it carries, else
 * its scene's prop; a scene without one draws nothing, so no theme wears another's.
 */
export function drawPixelProp(args: {
  g: CanvasRenderingContext2D
  a: TeamSceneActor
  t: number
  cx: number
  hy: number
  pixel: number
  prop: SceneProp | undefined
}): void {
  const { g, a, t, cx, hy, pixel, prop } = args
  const hx = cx + a.facing * 4
  const dot: Dot = (dx, dy, w, h, color) => {
    g.fillStyle = color
    const x = a.facing > 0 ? hx + dx : hx - dx - w + 1
    g.fillRect(x * pixel, (hy + dy) * pixel, w * pixel, h * pixel)
  }
  if (a.carrying || a.pose === 'give') {
    dot(1, 0, 3, 2, PAPER)
    return
  }
  const isHeld = ['raise', 'wave', 'cheer', 'done', 'work'].includes(a.pose)
  if (prop === undefined || !isHeld) {
    return
  }
  const swing =
    a.pose === 'work'
      ? Math.max(0, 1 - (((t % SWING_SECONDS) + SWING_SECONDS) % SWING_SECONDS) * SWING_FADE)
      : 0
  if (prop === 'sword') {
    drawSword(dot, a, t, swing)
  } else {
    drawSprite(dot, a, t, swing, prop)
  }
}

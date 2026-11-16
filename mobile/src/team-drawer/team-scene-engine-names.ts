// Part of the Team scene WebView engine (team-scene-engine.ts): the names under the figures.
import type { TeamSceneActor } from '../../../src/shared/team-scene/team-scene-types'
import type { TeamScenePainter } from '../../../src/renderer/src/components/team-scene/team-scene-painter'

const NAME_FONT = '600 10px -apple-system, system-ui, sans-serif'
const NAME_MAX = 64
// Why below the feet: names over the heads would sit where the bubbles and alert marks go.
const NAME_GAP = 3

const ellipsized = (g: CanvasRenderingContext2D, name: string): string => {
  if (g.measureText(name).width <= NAME_MAX) {
    return name
  }
  let cut = name
  while (cut.length > 1 && g.measureText(`${cut}…`).width > NAME_MAX) {
    cut = cut.slice(0, -1)
  }
  return `${cut}…`
}

/** Each figure's name under its feet, so the phone tells who is who without hovering. */
export function drawTeamSceneNames(
  g: CanvasRenderingContext2D,
  actors: readonly TeamSceneActor[],
  painter: TeamScenePainter,
  width: number,
  height: number
): void {
  g.font = NAME_FONT
  g.textAlign = 'center'
  g.textBaseline = 'top'
  const drawn: { left: number; right: number; y: number }[] = []
  // Why members, then the lead and advisor, then walkers: a desk's name must never lose its row
  // to someone standing beside it or passing by.
  const rank = (a: TeamSceneActor) => (a.pose === 'walk' ? 2 : a.role === 'member' ? 0 : 1)
  const order = [...actors].sort((a, b) => rank(a) - rank(b))
  for (const a of order) {
    if (a.away) {
      continue
    }
    const name = ellipsized(g, a.name)
    const w = g.measureText(name).width + 6
    const x = Math.min(Math.max(a.x * width, w / 2 + 1), width - w / 2 - 1)
    const feet = painter.feetAt?.(a.depth, height) ?? height - 14
    const top = Math.min(feet + NAME_GAP, height - 26)
    const [left, right] = [x - w / 2, x + w / 2]
    const free = (y: number) =>
      !drawn.some((o) => o.left < right && left < o.right && Math.abs(o.y - y) < 13)
    // Why a second row: at 320 pt neighbouring desks sit closer than a name is wide.
    const y = [top, top + 13].find(free)
    if (y === undefined) {
      continue
    }
    drawn.push({ left, right, y })
    g.fillStyle = 'rgb(10 12 16 / 0.72)'
    g.fillRect(x - w / 2, y - 1, w, 13)
    g.fillStyle = '#eef0f4'
    g.fillText(name, x, y)
  }
}

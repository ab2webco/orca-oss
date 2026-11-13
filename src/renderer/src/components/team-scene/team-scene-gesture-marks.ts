import type { TeamSceneGesture } from '../../../../shared/team-scene/team-scene-types'
import type { TeamSceneStatusColors } from './team-scene-painter-marks'

const TAU = 2 * Math.PI
// Scene art, not UI chrome: the plate behind a neutral mark and the ink on it.
const PLATE = 'rgb(20 20 30 / 0.78)'
const INK = '#ffffff'
const CARD = { width: 7, height: 10 }

type Draw = (g: CanvasRenderingContext2D, colors: TeamSceneStatusColors) => void

const plate = (g: CanvasRenderingContext2D, color = PLATE): void => {
  g.fillStyle = color
  g.beginPath()
  g.arc(0, 0, 7, 0, TAU)
  g.fill()
}

const line = (g: CanvasRenderingContext2D, points: [number, number][]): void => {
  g.beginPath()
  points.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)))
  g.stroke()
}

// A referee's card held up: yellow for unsure, red for escalated.
const card =
  (tone: 'risk' | 'attention'): Draw =>
  (g, colors) => {
    g.fillStyle = INK
    g.fillRect(-CARD.width / 2 - 1, -CARD.height / 2 - 1, CARD.width + 2, CARD.height + 2)
    g.fillStyle = colors[tone]
    g.fillRect(-CARD.width / 2, -CARD.height / 2, CARD.width, CARD.height)
  }

const arrow =
  (up: boolean): Draw =>
  (g) => {
    plate(g)
    const s = up ? -1 : 1
    line(g, [
      [0, -3.6 * s],
      [0, 3.6 * s]
    ])
    line(g, [
      [-3, 0.8 * s],
      [0, 3.8 * s],
      [3, 0.8 * s]
    ])
  }

const flag =
  (tone: 'done' | 'attention'): Draw =>
  (g, colors) => {
    plate(g)
    line(g, [
      [-3, 4.5],
      [-3, -4.5]
    ])
    g.fillStyle = colors[tone]
    g.beginPath()
    g.moveTo(-3, -4.5)
    g.lineTo(4, -2.5)
    g.lineTo(-3, -0.5)
    g.fill()
  }

// Speech dots: Jev asked or gave advice, with no verdict to show.
const dots: Draw = (g) => {
  plate(g)
  g.fillStyle = INK
  for (const x of [-3, 0, 3]) {
    g.fillRect(x - 0.9, -0.9, 1.8, 1.8)
  }
}

const DRAW: Record<TeamSceneGesture, Draw> = {
  lowered: arrow(false),
  raised: arrow(true),
  approved: (g, colors) => {
    plate(g, colors.done)
    line(g, [
      [-3, 0.2],
      [-0.8, 2.6],
      [3.2, -2.4]
    ])
  },
  unsure: card('risk'),
  escalated: card('attention'),
  ciRunning: (g) => {
    plate(g)
    g.beginPath()
    g.arc(0, 0.8, 3.8, 0, TAU)
    g.stroke()
    line(g, [
      [0, 0.8],
      [0, -1.8]
    ])
    line(g, [
      [-1.2, -4.6],
      [1.2, -4.6]
    ])
  },
  ciPassed: flag('done'),
  ciFailed: flag('attention'),
  stopped: (g, colors) => {
    plate(g, colors.attention)
    line(g, [
      [-3.6, 0],
      [3.6, 0]
    ])
  },
  consulting: dots,
  advised: dots
}

/** The advisor's mark for a Jev decision, centred at `x, y` above its head. */
export function drawSceneGesture(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  gesture: TeamSceneGesture,
  colors: TeamSceneStatusColors
): void {
  g.save()
  g.translate(x, y)
  g.strokeStyle = INK
  g.lineWidth = 1.8
  g.lineCap = 'round'
  g.lineJoin = 'round'
  DRAW[gesture](g, colors)
  g.restore()
}

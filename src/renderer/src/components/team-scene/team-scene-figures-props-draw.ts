import { drawCastleBuilds } from './team-scene-castle-sites'
import { figuresPropsOf, type FiguresProp } from './team-scene-figures-props'
import type { TeamSceneFrame } from './team-scene-painter'

type Feet = (depth: number, height: number) => number

// Why these shapes and colours: prototype V30's drawProps, drawn at each prop's placed x.
function drawCampfire(g: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  const glow = g.createRadialGradient(x, y - 10, 2, x, y - 10, 46)
  glow.addColorStop(0, `rgb(255 150 60 / ${0.42 + 0.1 * Math.sin(t * 9)})`)
  glow.addColorStop(1, 'rgb(255 150 60 / 0)')
  g.fillStyle = glow
  g.fillRect(x - 46, y - 56, 92, 92)
  const stone = g.createLinearGradient(x - 13, y - 26, x + 13, y)
  stone.addColorStop(0, '#77706c')
  stone.addColorStop(1, '#3c3735')
  g.fillStyle = stone
  g.beginPath()
  g.roundRect(x - 13, y - 26, 26, 27, 5)
  g.fill()
  g.fillStyle = '#1c1412'
  g.beginPath()
  g.roundRect(x - 7, y - 17, 14, 13, 4)
  g.fill()
  const fire = g.createRadialGradient(x, y - 5, 1, x, y - 9, 10)
  fire.addColorStop(0, '#fff2b0')
  fire.addColorStop(0.5, '#ff9a3c')
  fire.addColorStop(1, 'rgb(200 50 20 / 0)')
  g.fillStyle = fire
  g.fillRect(x - 7, y - 17, 14, 13)
}

function drawAnvil(g: CanvasRenderingContext2D, x: number, y: number): void {
  g.fillStyle = '#46505c'
  g.beginPath()
  g.moveTo(x - 9, y - 13)
  g.lineTo(x + 9, y - 13)
  g.lineTo(x + 5, y - 9)
  g.lineTo(x + 3, y - 3)
  g.lineTo(x + 6, y)
  g.lineTo(x - 6, y)
  g.lineTo(x - 3, y - 3)
  g.lineTo(x - 5, y - 9)
  g.closePath()
  g.fill()
  g.fillStyle = 'rgb(255 255 255 / 0.22)'
  g.fillRect(x - 9, y - 13, 18, 1.2)
}

function drawLectern(g: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  g.strokeStyle = '#5a3f26'
  g.lineWidth = 2.6
  g.beginPath()
  g.moveTo(x, y)
  g.lineTo(x, y - 17)
  g.stroke()
  g.fillStyle = '#6d4c2f'
  g.beginPath()
  g.moveTo(x - 10, y - 19)
  g.lineTo(x + 10, y - 22)
  g.lineTo(x + 10, y - 18)
  g.lineTo(x - 10, y - 15)
  g.fill()
  g.fillStyle = '#f1e6c8'
  g.beginPath()
  g.moveTo(x - 9, y - 21)
  g.quadraticCurveTo(x, y - 25, x + 9, y - 24)
  g.lineTo(x + 9, y - 22)
  g.quadraticCurveTo(x, y - 23, x - 9, y - 19)
  g.fill()
  for (let i = 0; i < 3; i++) {
    const q = (t * 0.4 + i / 3) % 1
    g.fillStyle = `rgb(199 179 255 / ${1 - q})`
    g.beginPath()
    g.arc(x + Math.sin(q * 9 + i) * 5, y - 26 - q * 20, 1.1, 0, 7)
    g.fill()
  }
}

function drawFlag(g: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  g.strokeStyle = '#4a3626'
  g.lineWidth = 2
  g.beginPath()
  g.moveTo(x, y)
  g.lineTo(x, y - 48)
  g.stroke()
  g.fillStyle = '#b3263a'
  g.beginPath()
  g.moveTo(x, y - 47)
  for (let i = 0; i <= 8; i++) {
    g.lineTo(x + i * 3, y - 47 + Math.sin(t * 4 - i * 0.8) * 1.6 + i * 0.2)
  }
  for (let i = 8; i >= 0; i--) {
    g.lineTo(x + i * 3, y - 33 + Math.sin(t * 4 - i * 0.8) * 1.6 - i * 0.6)
  }
  g.closePath()
  g.fill()
  g.fillStyle = '#f2c94c'
  g.beginPath()
  g.arc(x + 10, y - 40, 2.4, 0, 7)
  g.fill()
}

/** Draws the placed props on the ground; the caller draws them before the actors. */
export function drawFiguresProps(
  g: CanvasRenderingContext2D,
  props: readonly FiguresProp[],
  height: number,
  t: number,
  feetY: Feet
): void {
  for (const prop of props) {
    const y = feetY(prop.depth, height)
    switch (prop.kind) {
      case 'campfire':
        drawCampfire(g, prop.x, y, t)
        break
      case 'anvil':
        drawAnvil(g, prop.x, y)
        break
      case 'lectern':
        drawLectern(g, prop.x, y, t)
        break
      case 'flag':
        drawFlag(g, prop.x, y, t)
        break
    }
  }
}

/** Figures' ground: the castle builds, then V30's props, both before the actors stand on it (ORCA-1150). */
export function drawFiguresScenery(
  g: CanvasRenderingContext2D,
  f: TeamSceneFrame,
  feetY: Feet
): void {
  drawCastleBuilds(g, f, feetY)
  drawFiguresProps(g, figuresPropsOf(f), f.height, f.t, feetY)
}

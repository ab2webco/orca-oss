// Version 28's Figures backdrop: drawn once per size; only the clouds and window flicker move.
const TAU = 2 * Math.PI

function ridge(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  base: number,
  amp: number,
  seed: number,
  fill: CanvasGradient
): void {
  g.beginPath()
  g.moveTo(0, h)
  for (let x = 0; x <= w; x += 4) {
    const wave =
      Math.sin(x * 0.012 + seed) +
      0.5 * Math.sin(x * 0.031 + seed * 2.1) +
      0.22 * Math.sin(x * 0.083 + seed * 3.3)
    g.lineTo(x, base - amp * wave)
  }
  g.lineTo(w, h)
  g.closePath()
  g.fillStyle = fill
  g.fill()
}

const vertical = (
  g: CanvasRenderingContext2D,
  y0: number,
  y1: number,
  stops: [number, string][]
): CanvasGradient => {
  const gradient = g.createLinearGradient(0, y0, 0, y1)
  for (const [at, color] of stops) {
    gradient.addColorStop(at, color)
  }
  return gradient
}

/** Where the castle's windows sit, so the flicker lands on them. */
export const figuresCastleAt = (w: number, h: number): { x: number; y: number } => ({
  x: w * 0.84,
  y: h * 0.56
})

export function paintFiguresBackdrop(g: CanvasRenderingContext2D, w: number, h: number): void {
  g.fillStyle = vertical(g, 0, h * 0.72, [
    [0, '#27365f'],
    [0.45, '#7d6f9e'],
    [0.8, '#f0a57a'],
    [1, '#fcd9a0']
  ])
  g.fillRect(0, 0, w, h)
  const sx = w * 0.72
  const sy = h * 0.5
  const sun = g.createRadialGradient(sx, sy, 2, sx, sy, w * 0.55)
  sun.addColorStop(0, 'rgb(255 244 214 / 0.95)')
  sun.addColorStop(0.09, 'rgb(255 224 170 / 0.6)')
  sun.addColorStop(1, 'rgb(255 200 140 / 0)')
  g.fillStyle = sun
  g.fillRect(0, 0, w, h)
  for (let i = 0; i < 46; i++) {
    g.fillStyle = `rgb(255 255 255 / ${0.15 + ((i * 7) % 10) / 20})`
    g.beginPath()
    g.arc((i * 97) % w, (i * 53) % (h * 0.34), 0.55, 0, TAU)
    g.fill()
  }
  ridge(
    g,
    w,
    h,
    h * 0.5,
    13,
    1.2,
    vertical(g, h * 0.3, h * 0.7, [
      [0, '#7a7fae'],
      [1, '#d6a48e']
    ])
  )
  ridge(
    g,
    w,
    h,
    h * 0.6,
    10,
    3.1,
    vertical(g, h * 0.4, h * 0.8, [
      [0, '#566891'],
      [1, '#a98a84']
    ])
  )
  const castle = figuresCastleAt(w, h)
  g.fillStyle = '#3b3f63'
  const towers = [
    [-16, -6, 8, 18, 4],
    [-7, -18, 14, 30, 7],
    [8, -10, 9, 22, 4.5],
    [17, -3, 7, 15, 3.5]
  ] as const
  for (const [x, y, tw, th, roof] of towers) {
    g.fillRect(castle.x + x, castle.y + y, tw, th)
    const mid = castle.x + x + tw / 2
    g.beginPath()
    g.moveTo(mid - roof - 1, castle.y + y)
    g.lineTo(mid, castle.y + y - roof * 2.1)
    g.lineTo(mid + roof + 1, castle.y + y)
    g.fill()
  }
  ridge(
    g,
    w,
    h,
    h * 0.72,
    6,
    5.4,
    vertical(g, h * 0.55, h * 0.85, [
      [0, '#3d5a5c'],
      [1, '#2d4a3e']
    ])
  )
  for (let i = 0; i < 34; i++) {
    const x = (i * 61.7) % w
    const y = h * 0.72 + Math.sin(i * 2.3) * 5
    const s = 7 + ((i * 13) % 7)
    g.fillStyle = vertical(g, y - s * 2, y + 2, [
      [0, '#2f5b4e'],
      [1, '#16302b']
    ])
    g.beginPath()
    g.moveTo(x, y - s * 2)
    g.quadraticCurveTo(x + s * 0.75, y - s * 0.5, x + s * 0.62, y + 2)
    g.lineTo(x - s * 0.62, y + 2)
    g.quadraticCurveTo(x - s * 0.75, y - s * 0.5, x, y - s * 2)
    g.fill()
  }
  g.fillStyle = vertical(g, h * 0.76, h, [
    [0, '#6f8f45'],
    [1, '#2c4a2c']
  ])
  g.fillRect(0, h * 0.78, w, h)
  g.fillStyle = vertical(g, h * 0.82, h, [
    [0, '#dcbb8a'],
    [1, '#9c7a50']
  ])
  g.beginPath()
  g.moveTo(-10, h * 0.86)
  for (let x = -10; x <= w + 10; x += 10) {
    g.lineTo(x, h * 0.85 + Math.sin(x * 0.02) * 1.5)
  }
  for (let x = w + 10; x >= -10; x -= 10) {
    g.lineTo(x, h * 0.97 + Math.sin(x * 0.017 + 1) * 1.5)
  }
  g.fill()
  const ray = g.createLinearGradient(sx, 0, sx - w * 0.4, h)
  ray.addColorStop(0, 'rgb(255 236 190 / 0.17)')
  ray.addColorStop(1, 'rgb(255 236 190 / 0)')
  g.fillStyle = ray
  for (const [a, b] of [
    [-0.1, 0.1],
    [0.2, 0.34],
    [0.5, 0.58]
  ] as const) {
    g.beginPath()
    g.moveTo(sx, sy)
    g.lineTo(a * w, h)
    g.lineTo(b * w, h)
    g.fill()
  }
}

/** One soft cloud, drawn once and reused at three sizes as it drifts. */
export function paintFiguresCloud(g: CanvasRenderingContext2D): void {
  const shape = (dy: number): void => {
    g.beginPath()
    for (const [x, y, r] of [
      [56, 48, 18],
      [88, 38, 25],
      [126, 30, 31],
      [164, 40, 24],
      [194, 49, 15]
    ] as const) {
      g.moveTo(x + r, y + dy)
      g.arc(x, y + dy, r, 0, TAU)
    }
    g.roundRect(38, 46 + dy, 172, 18, 9)
  }
  g.fillStyle = vertical(g, 0, 66, [
    [0, '#fff3e2'],
    [0.6, '#f7cdb4'],
    [1, '#c99aa6']
  ])
  shape(0)
  g.fill()
  g.globalCompositeOperation = 'source-atop'
  g.fillStyle = 'rgb(120 92 140 / 0.28)'
  shape(13)
  g.fill()
  g.globalCompositeOperation = 'source-over'
}

const CLOUDS = [
  [0.06, 8, 0.42, 0.95],
  [0.035, 30, 0.3, 0.8],
  [0.09, 2, 0.24, 0.7]
] as const

export function drawFiguresSky(
  g: CanvasRenderingContext2D,
  cloud: CanvasImageSource,
  w: number,
  h: number,
  t: number
): void {
  CLOUDS.forEach(([speed, y, scale, alpha], i) => {
    const cw = 240 * scale
    const x = ((t * speed * 60 + i * 230) % (w + cw)) - cw
    g.globalAlpha = alpha
    g.drawImage(cloud, x, y, cw, 70 * scale)
  })
  g.globalAlpha = 1
  const castle = figuresCastleAt(w, h)
  g.fillStyle = `rgb(255 214 120 / ${0.65 + 0.35 * Math.sin(t * 5.3)})`
  for (const [x, y] of [
    [-2, -8],
    [3, -2],
    [-11, 1],
    [12, 1]
  ] as const) {
    g.fillRect(castle.x + x, castle.y + y, 1.6, 2.4)
  }
}

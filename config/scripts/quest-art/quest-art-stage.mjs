// Quest's stages at 2x: an open road at dusk for Figures, a tower office for Office.

export const STAGE = { width: 768, height: 176 }
const { width: W, height: H } = STAGE
const TAU = 2 * Math.PI

// Fixed noise: a generated sheet must not change between runs.
const noise = (at) => {
  const x = Math.sin(at * 127.1) * 43758.5453
  return x - Math.floor(x)
}

function ridge(g, base, amp, seed, fill) {
  g.beginPath()
  g.moveTo(0, H)
  for (let x = 0; x <= W; x += 3) {
    g.lineTo(
      x,
      base - amp * (Math.sin(x * 0.0121 + seed) + 0.5 * Math.sin(x * 0.0313 + seed * 2.1))
    )
  }
  g.lineTo(W, H)
  g.closePath()
  g.fillStyle = fill
  g.fill()
}

function cloud(g, x, y, s) {
  g.save()
  g.translate(x, y)
  g.scale(s, s)
  const puffs = [
    [-22, 2, 11],
    [-8, -4, 15],
    [10, -6, 17],
    [27, 0, 12],
    [2, 4, 15]
  ]
  g.fillStyle = 'rgb(214 186 196 / 0.9)'
  for (const [px, py, r] of puffs) {
    g.beginPath()
    g.arc(px, py + 3, r, 0, TAU)
    g.fill()
  }
  g.fillStyle = 'rgb(255 236 226 / 0.95)'
  for (const [px, py, r] of puffs) {
    g.beginPath()
    g.arc(px - 1, py - 1, r * 0.82, 0, TAU)
    g.fill()
  }
  g.restore()
}

export function paintFiguresSky(g) {
  const sky = g.createLinearGradient(0, 0, 0, H * 0.74)
  sky.addColorStop(0, '#27365f')
  sky.addColorStop(0.45, '#7d6f9e')
  sky.addColorStop(0.8, '#f0a57a')
  sky.addColorStop(1, '#fcd9a0')
  g.fillStyle = sky
  g.fillRect(0, 0, W, H)
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgb(255 255 255 / ${0.2 + noise(i) * 0.55})`
    g.fillRect(noise(i + 300) * W, noise(i + 600) * H * 0.34, 0.9, 0.9)
  }
  cloud(g, 150, 34, 0.8)
  cloud(g, 420, 22, 0.62)
  cloud(g, 660, 40, 0.7)
  ridge(g, H * 0.52, 12, 1.2, '#8a83ad')
  ridge(g, H * 0.6, 9, 3.1, '#5f6f94')
}

function pine(g, x, y, s) {
  g.fillStyle = '#3a2a20'
  g.fillRect(x - 1.4 * s, y - 5 * s, 2.8 * s, 6 * s)
  for (const [at, half, tone] of [
    [0, 9, '#1f4a3c'],
    [8, 7.4, '#245443'],
    [15, 5.4, '#2a5f4c']
  ]) {
    g.fillStyle = tone
    g.beginPath()
    g.moveTo(x - half * s, y - (3 + at) * s)
    g.lineTo(x, y - (15 + at) * s)
    g.lineTo(x + half * s, y - (3 + at) * s)
    g.closePath()
    g.fill()
  }
}

function tower(g, x, y, width, height, roof) {
  g.fillStyle = '#343a66'
  g.fillRect(x, y - height, width, height)
  g.fillStyle = roof
  g.beginPath()
  g.moveTo(x - 2.4, y - height)
  g.lineTo(x + width / 2, y - height - width * 1.4)
  g.lineTo(x + width + 2.4, y - height)
  g.closePath()
  g.fill()
  g.fillStyle = 'rgb(255 214 150 / 0.9)'
  for (let at = 1; at <= Math.floor(height / 16); at++) {
    g.fillRect(x + width / 2 - 1, y - height + at * 12, 2, 4.4)
  }
}

function castle(g, x, y) {
  g.fillStyle = '#2b3058'
  g.fillRect(x, y - 24, 66, 24)
  tower(g, x - 10, y, 13, 46, '#3a3f76')
  tower(g, x + 24, y, 16, 62, '#454a86')
  tower(g, x + 60, y, 13, 38, '#3a3f76')
}

function pennant(g, x, y) {
  g.fillStyle = '#4a3a2c'
  g.fillRect(x, y - 48, 2, 48)
  g.fillStyle = '#b3263a'
  g.beginPath()
  g.moveTo(x + 2, y - 47)
  g.quadraticCurveTo(x + 16, y - 50, x + 28, y - 42)
  g.quadraticCurveTo(x + 15, y - 39, x + 2, y - 33)
  g.closePath()
  g.fill()
  g.fillStyle = '#f2c94c'
  g.beginPath()
  g.arc(x + 10, y - 41.5, 2.4, 0, TAU)
  g.fill()
}

export function paintFiguresLand(g) {
  castle(g, 486, H * 0.68)
  ridge(g, H * 0.72, 6, 5.4, '#33524a')
  for (const [x, s] of [
    [34, 1],
    [118, 0.8],
    [206, 1.1],
    [316, 0.85],
    [420, 1],
    [612, 0.9],
    [712, 1.1]
  ]) {
    pine(g, x, H * 0.74, s)
  }
  const grass = g.createLinearGradient(0, H * 0.74, 0, H)
  grass.addColorStop(0, '#6f8f45')
  grass.addColorStop(1, '#2c4a2c')
  g.fillStyle = grass
  g.fillRect(0, H * 0.76, W, H)
  const road = g.createLinearGradient(0, H * 0.8, 0, H * 0.97)
  road.addColorStop(0, '#d9bb88')
  road.addColorStop(1, '#b7966a')
  g.fillStyle = road
  g.beginPath()
  g.moveTo(0, H * 0.82)
  for (let x = 0; x <= W; x += 6) {
    g.lineTo(x, H * 0.82 + Math.sin(x * 0.012) * 2)
  }
  for (let x = W; x >= 0; x -= 6) {
    g.lineTo(x, H * 0.97 + Math.sin(x * 0.009 + 1) * 1.6)
  }
  g.closePath()
  g.fill()
  for (let i = 0; i < 70; i++) {
    g.fillStyle = `rgb(120 92 60 / ${0.18 + noise(i + 40) * 0.3})`
    g.fillRect(noise(i + 900) * W, H * (0.84 + noise(i + 1200) * 0.11), 2 + noise(i) * 3, 0.8)
  }
  pennant(g, 590, H * 0.8)
}

export function paintFiguresFront(g) {
  for (let i = 0; i < 260; i++) {
    const x = noise(i + 70) * W
    const tall = 3 + noise(i + 170) * 6
    g.strokeStyle = noise(i + 270) > 0.5 ? '#2c5a33' : '#3d7040'
    g.lineWidth = 1
    g.beginPath()
    g.moveTo(x, H)
    g.quadraticCurveTo(x + 1, H - tall * 0.6, x + (noise(i) - 0.5) * 4, H - tall)
    g.stroke()
  }
}

// A station prop is 120 wide with the seat at its center, so the work sits right of whoever uses it.
export const STATION_WIDTH = 120

export function paintForge(g) {
  g.save()
  g.translate(STATION_WIDTH / 2 + 26, 44)
  g.fillStyle = 'rgb(20 20 30 / 0.3)'
  g.beginPath()
  g.ellipse(0, 0, 21, 3.4, 0, 0, TAU)
  g.fill()
  g.fillStyle = '#4b5261'
  g.beginPath()
  g.roundRect(-18, -11, 36, 4, 1.4)
  g.fill()
  g.fillStyle = '#373d4a'
  g.fillRect(-10, -7, 20, 7)
  g.fillRect(-14, -1.6, 28, 2)
  g.fillStyle = '#5b6474'
  g.fillRect(-16, -11, 32, 1.2)
  g.fillStyle = '#6a4326'
  g.beginPath()
  g.roundRect(9, -18, 10, 7, 1.2)
  g.fill()
  g.restore()
}

function officeCity(g, right) {
  const sky = g.createLinearGradient(0, 6, 0, 100)
  sky.addColorStop(0, '#2b2f5c')
  sky.addColorStop(0.55, '#b86a78')
  sky.addColorStop(1, '#f4b271')
  g.fillStyle = sky
  g.fillRect(0, 6, right, 94)
  for (let b = 0; b < 42; b++) {
    const x = b * 14.6 - 6 + noise(b) * 6
    const tall = 28 + noise(b + 50) * 54
    const wide = 12 + noise(b + 90) * 14
    g.fillStyle = b % 2 ? '#23274a' : '#2d3158'
    g.fillRect(x, 100 - tall, wide, tall)
    for (let row = 0; row < tall / 7 - 1; row++) {
      for (let col = 0; col < wide / 4 - 1; col++) {
        if (noise(b * 31 + row * 7 + col) > 0.45) {
          g.fillStyle = 'rgb(255 222 160 / 0.72)'
          g.fillRect(x + 2 + col * 4, 100 - tall + 3 + row * 7, 1.6, 2.6)
        }
      }
    }
  }
}

function pendant(g, x) {
  g.strokeStyle = '#0c0e13'
  g.lineWidth = 1
  g.beginPath()
  g.moveTo(x, 0)
  g.lineTo(x, 22)
  g.stroke()
  g.fillStyle = '#2a2e38'
  g.beginPath()
  g.moveTo(x - 11, 29)
  g.lineTo(x - 5, 22)
  g.lineTo(x + 5, 22)
  g.lineTo(x + 11, 29)
  g.closePath()
  g.fill()
  const glow = g.createRadialGradient(x, 30, 1, x, 62, 76)
  glow.addColorStop(0, 'rgb(255 224 170 / 0.34)')
  glow.addColorStop(1, 'rgb(255 224 170 / 0)')
  g.fillStyle = glow
  g.fillRect(x - 80, 28, 160, 100)
}

function board(g, x, y, wide) {
  g.fillStyle = '#e6eaf0'
  g.beginPath()
  g.roundRect(x, y, wide, 48, 2)
  g.fill()
  const notes = ['#ffd24a', '#7fd1ae', '#8ab8ff', '#ffa8a8']
  notes.forEach((color, col) => {
    for (let row = 0; row < 3 - (col % 2); row++) {
      g.fillStyle = color
      g.fillRect(x + 5 + (col * wide) / 4.4, y + 5 + row * 14, wide / 6.5, 10)
    }
  })
}

function planter(g, x, y) {
  g.fillStyle = '#d9d4c8'
  g.beginPath()
  g.roundRect(x - 8, y - 17, 16, 17, 3)
  g.fill()
  for (let i = -4; i <= 4; i++) {
    g.fillStyle = i % 2 ? '#2f7a56' : '#39906a'
    g.beginPath()
    g.ellipse(x + i * 3.2, y - 28 - (4 - Math.abs(i)) * 4, 2.8, 14, i * 0.3, 0, TAU)
    g.fill()
  }
}

export function paintOfficeRoom(g) {
  const glass = 590
  g.fillStyle = '#1c2029'
  g.fillRect(0, 0, W, 104)
  officeCity(g, glass)
  g.fillStyle = '#14171e'
  for (let i = 0; i <= 5; i++) {
    g.fillRect((i * glass) / 5 - 1, 6, 2.4, 94)
  }
  g.fillRect(0, 0, W, 6)
  g.fillRect(0, 30, glass, 1.2)
  const floor = g.createLinearGradient(0, 104, 0, H)
  floor.addColorStop(0, '#4b4f58')
  floor.addColorStop(1, '#2c2f37')
  g.fillStyle = floor
  g.fillRect(0, 104, W, H - 104)
  g.fillStyle = 'rgb(244 178 113 / 0.1)'
  for (let i = 0; i < 5; i++) {
    const left = (i * glass) / 5
    const right = ((i + 1) * glass) / 5
    g.beginPath()
    g.moveTo(left + 6, 104)
    g.lineTo(right - 4, 104)
    g.lineTo(right + 26, H)
    g.lineTo(left + 30, H)
    g.closePath()
    g.fill()
  }
  g.fillStyle = '#262b36'
  g.fillRect(glass, 6, W - glass, 98)
  board(g, glass + 26, 24, 118)
  g.fillStyle = 'rgb(170 205 230 / 0.1)'
  g.fillRect(glass, 6, W - glass, 98)
  g.strokeStyle = 'rgb(200 225 245 / 0.35)'
  g.lineWidth = 1
  g.strokeRect(glass, 6, W - glass - 1, 98)
  g.beginPath()
  g.moveTo(glass + 6, 8)
  g.lineTo(glass + 26, 100)
  g.stroke()
  g.fillStyle = '#14171e'
  g.fillRect(0, 102, W, 2.4)
  for (const x of [120, 300, 480]) {
    pendant(g, x)
  }
  planter(g, 748, 124)
}

function chair(g) {
  g.fillStyle = '#14171e'
  g.fillRect(-9, -1.5, 18, 1.6)
  g.fillRect(-1.2, -9, 2.4, 8)
  g.beginPath()
  g.roundRect(-9, -11.5, 19, 3.4, 1.6)
  g.fill()
  g.beginPath()
  g.moveTo(-10, -11)
  g.quadraticCurveTo(-14, -20, -11, -33)
  g.lineTo(-7, -33)
  g.quadraticCurveTo(-9, -20, -6, -11)
  g.closePath()
  g.fill()
}

export function paintDesk(g) {
  g.save()
  g.translate(STATION_WIDTH / 2, 60)
  g.fillStyle = 'rgb(16 18 26 / 0.34)'
  g.beginPath()
  g.ellipse(22, 0, 38, 3.6, 0, 0, TAU)
  g.fill()
  chair(g)
  g.translate(14, 0)
  g.fillStyle = '#d8d4cc'
  g.beginPath()
  g.roundRect(0, -23, 42, 2.8, 1)
  g.fill()
  g.fillStyle = '#1b1e26'
  g.fillRect(3, -20.4, 2.2, 20)
  g.fillRect(37, -20.4, 2.2, 20)
  g.fillRect(0, -1, 9, 1.4)
  g.fillRect(33, -1, 9, 1.4)
  g.fillRect(24, -29, 3, 6.4)
  g.fillRect(18, -24.4, 15, 1.4)
  g.fillStyle = '#0e1117'
  g.beginPath()
  g.roundRect(10, -50, 32, 22, 1.8)
  g.fill()
  g.fillStyle = '#0f1826'
  g.fillRect(11.6, -48.4, 28.8, 18.8)
  g.fillStyle = '#b9bec8'
  g.beginPath()
  g.roundRect(1, -24.8, 13, 1.8, 0.8)
  g.fill()
  g.restore()
}

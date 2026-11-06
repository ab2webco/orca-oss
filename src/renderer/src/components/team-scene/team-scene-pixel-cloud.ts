// The game's Pixel thought cloud (hd-thought.ts colours), on the scene's own pixel grid.
const LIGHT = '#ffffff'
const CLOUD = '#f4f4f0'
const SHADE = '#c9ccd6'
const OUTLINE = '#7d879c'
const ROW = 4096

export type PixelCloud = { rows: number; pixels: Map<number, string> }

/**
 * A cloud `width` x `height` grid cells with puffs on top and lumps underneath, plus a
 * two-square trail toward (tailX, tailY), the speaker's head; `bob` lifts the trail a step.
 */
export function pixelCloudOf(args: {
  width: number
  height: number
  tailX: number
  tailY: number
  bob: number
}): PixelCloud {
  const { width, height, tailX, tailY, bob } = args
  const rows = Math.max(height, tailY)
  const top = 5
  const base = height - 3
  const left = 2
  const right = width - 3
  const shape = new Map<number, string>()
  const put = (x: number, y: number, color: string): void => {
    if (x >= 0 && x < width && y >= 0 && y < rows) {
      shape.set(y * ROW + x, color)
    }
  }
  for (let x = left; x <= right; x++) {
    for (let y = top - 1; y <= base; y++) {
      const corner = (x === left || x === right) && (y === top - 1 || y === base)
      if (!corner) {
        put(x, y, y === base ? SHADE : CLOUD)
      }
    }
  }
  for (let y = top + 1; y < base - 1; y++) {
    put(left - 1, y, CLOUD)
    put(right + 1, y, CLOUD)
  }
  const lift = 3
  const puffs = Math.max(2, Math.round((right - left) / 20))
  for (let k = 0; k < puffs; k++) {
    const cx = Math.round(left + 7 + (k * (right - left - 14)) / (puffs - 1))
    for (let dy = 1; dy <= lift; dy++) {
      for (let dx = -7; dx <= 7; dx++) {
        if ((dx * dx) / 49 + (dy * dy) / 12.5 <= 1 && cx + dx > left && cx + dx < right) {
          put(cx + dx, top - 1 - dy, dy === lift ? LIGHT : CLOUD)
        }
      }
    }
  }
  for (let cx = left + 4; cx + 4 <= right - 2; cx += 9) {
    for (let dx = 0; dx < 5; dx++) {
      put(cx + dx, base + 1, SHADE)
    }
  }
  const near = Math.max(left + 1, Math.min(right - 3, tailX - 1))
  const drift = Math.max(-3, Math.min(3, tailX - near - 1))
  for (const [x, y, n] of [
    [near, base + 4 + bob, 3],
    [near + drift, base + 8 + bob, 2]
  ] as const) {
    if (y + n <= tailY) {
      for (let dy = 0; dy < n; dy++) {
        for (let dx = 0; dx < n; dx++) {
          put(x + dx, y + dy, dx === 0 && dy === 0 ? LIGHT : CLOUD)
        }
      }
    }
  }
  const pixels = new Map<number, string>()
  for (const key of shape.keys()) {
    const x = key % ROW
    const y = Math.floor(key / ROW)
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1]
    ] as const) {
      if (nx < 0 || nx >= width || ny < 0 || ny >= rows || shape.has(ny * ROW + nx)) {
        continue
      }
      const touching = [
        [nx - 1, ny],
        [nx + 1, ny],
        [nx, ny - 1],
        [nx, ny + 1]
      ].filter(([ax, ay]) => shape.has(ay! * ROW + ax!)).length
      // Why at most two: a stepped outline, not a filled ring around inner corners.
      if (touching <= 2) {
        pixels.set(ny * ROW + nx, OUTLINE)
      }
    }
  }
  for (const [key, color] of shape) {
    pixels.set(key, color)
  }
  return { rows, pixels }
}

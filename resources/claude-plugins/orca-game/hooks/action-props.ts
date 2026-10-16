import type { Action } from './quest-policy'

export const PROP_WIDTH = 6

const CHECK: readonly (readonly [number, number])[] = [
  [0, 6],
  [1, 7],
  [2, 6],
  [3, 5],
  [4, 4]
]

// The prop a character carries in front of it, dx columns past its sprite.
export const actionPixel = (
  action: Action | undefined,
  dx: number,
  y: number,
  tick: number
): number | undefined => {
  if (action === undefined || dx < 0 || dx >= PROP_WIDTH) {
    return undefined
  }
  const beat = Math.floor(tick / 2)
  switch (action) {
    case 'read': {
      if (y === 7 && dx <= 4) {
        return dx === 2 ? 0x8b5a2b : 0xf1e2b8
      }
      return y === 6 && dx === (beat % 2 === 0 ? 1 : 3) ? 0xffffff : undefined
    }
    case 'edit': {
      const pen = beat % 5
      if (y === 7 && dx <= pen) {
        return 0x3e2a78
      }
      if (dx === pen && (y === 5 || y === 6)) {
        return y === 5 ? 0xffffff : 0x9a7fe0
      }
      return undefined
    }
    case 'test': {
      if (Math.floor(tick / 12) % 2 === 1) {
        return CHECK.some(([cx, cy]) => cx === dx && cy === y) ? 0x7fd36a : undefined
      }
      const bug = beat % 4
      if (y === 7 && (dx === bug || dx === bug + 1)) {
        return 0xd83a2e
      }
      return y === 6 && dx === bug ? 0x1a1a1a : undefined
    }
    case 'commit': {
      if (y >= 6 && y <= 7 && dx >= 1 && dx <= 3) {
        return y === 6 ? 0xb06f2c : 0xd98a3d
      }
      const stamp = 2 + (beat % 4)
      return dx === 2 && y === stamp && y < 6 ? 0xe0b020 : undefined
    }
    case 'push': {
      const at = 7 - (beat % 6)
      if (dx === 2 && y >= at && y <= Math.min(8, at + 2)) {
        return 0x3fae6f
      }
      return y === at && (dx === 1 || dx === 3) ? 0x3fae6f : undefined
    }
    case 'merge': {
      const lit = beat % 5
      const upper = Math.round(5 + dx * 0.4)
      const lower = Math.round(8 - dx * 0.4)
      if (y === upper || y === lower) {
        return dx === lit ? 0xffffff : 0x9a7fe0
      }
      return undefined
    }
    case 'track': {
      const slide = beat % 3
      if (dx >= slide && dx <= slide + 2 && y >= 5 && y <= 7) {
        return y === 6 && dx === slide + 1 ? 0xffffff : 0x2684ff
      }
      return undefined
    }
  }
}

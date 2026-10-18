import { hash, mix } from './pixel-canvas'

// Effects over a finished hd frame: particles and reaction flashes.

export type ParticleKind = 'dust' | 'fireflies' | 'snow' | 'embers' | 'glitter'

export const particleKindOf = (
  sceneId: string,
  night: number,
  isResting: boolean
): ParticleKind => {
  if (isResting) {
    return 'embers'
  }
  if (sceneId === 'vigilante') {
    return 'snow'
  }
  if (sceneId === 'jrpg') {
    return 'glitter'
  }
  return night > 0.5 ? 'fireflies' : 'dust'
}

const particleOf = (
  kind: ParticleKind,
  i: number,
  columns: number,
  ground: number,
  tick: number,
  fireX: number
): { x: number; y: number; color: number } | undefined => {
  const seed = hash(i, 71)
  switch (kind) {
    case 'snow':
      return {
        x: (seed % columns) + Math.round(Math.sin((tick + i * 7) / 9) * 2),
        y: (Math.floor(tick / 2) + (seed >>> 8)) % Math.max(1, ground),
        color: 0xf2f5ff
      }
    case 'dust':
      return (tick + i) % 9 < 4
        ? undefined
        : {
            x: ((seed % columns) + Math.floor(tick / 5)) % columns,
            y:
              ((seed >>> 8) % Math.max(1, ground - 2)) + Math.round(Math.sin((tick + i * 11) / 13)),
            color: 0xfff3c4
          }
    case 'fireflies':
      return {
        x: (seed % columns) + Math.round(Math.sin((tick + i * 5) / 7) * 3),
        y:
          ground -
          2 -
          ((seed >>> 8) % Math.max(1, Math.floor(ground / 2))) +
          Math.round(Math.cos((tick + i * 3) / 6)),
        color: (tick + i * 3) % 12 < 6 ? 0xd9ff6a : 0x7a9a3a
      }
    case 'glitter':
      return (tick + i * 5) % 14 > 2
        ? undefined
        : { x: seed % columns, y: (seed >>> 8) % Math.max(1, ground - 1), color: 0xffffff }
    case 'embers': {
      if (i > 6) {
        return undefined
      }
      const y = ground - 3 - ((Math.floor(tick / 2) + (seed >>> 8)) % Math.max(1, ground - 2))
      return {
        x: fireX + (seed % 6) + Math.round(Math.sin((tick + i * 4) / 4)),
        y,
        color: y > ground - 7 ? 0xffb24a : 0xd2381e
      }
    }
  }
}

export const particlesInto = (
  buf: Uint32Array,
  columns: number,
  pixels: number,
  ground: number,
  tick: number,
  kind: ParticleKind,
  fireX = 0
): void => {
  const count = Math.max(4, Math.floor(columns / 7))
  for (let i = 0; i < count; i += 1) {
    const one = particleOf(kind, i, columns, ground, tick, fireX)
    if (one === undefined || one.x < 0 || one.x >= columns || one.y < 0 || one.y >= pixels) {
      continue
    }
    const at = one.y * columns + one.x
    buf[at] = kind === 'dust' ? mix(buf[at] ?? 0, one.color, 0.55) : one.color
  }
}

export const flashInto = (buf: Uint32Array, color: number, strength: number): void => {
  if (strength <= 0) {
    return
  }
  for (let i = 0; i < buf.length; i += 1) {
    buf[i] = mix(buf[i] ?? 0, color, strength)
  }
}

export const FLASH_COLOR: Readonly<Record<string, number>> = {
  merged: 0xffffff,
  fail: 0xff3a2e,
  xp: 0xffd84a,
  level: 0xffd84a,
  needs: 0xff6a5a
}

export const flashOf = (kind: string, age: number): number => {
  if (FLASH_COLOR[kind] === undefined || age < 0 || age > 4) {
    return 0
  }
  return kind === 'merged' && age < 2 ? 0.55 : (1 - age / 5) * 0.45
}

/** A floating text rises a row every four ticks from where it started. */
export const floatingRowOf = (startRow: number, age: number): number =>
  Math.max(0, startRow - Math.floor(age / 4))

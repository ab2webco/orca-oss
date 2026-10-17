// A cell is [codepoint, foreground, background]; UPPER_HALF packs two pixels per cell.
export const UPPER_HALF = 0x2580

export const hash = (x: number, y: number): number => {
  let h = (x * 374761393 + y * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return (h ^ (h >>> 16)) >>> 0
}

export const mix = (a: number, b: number, t: number): number => {
  const channel = (shift: number) =>
    Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t)
  return (channel(16) << 16) | (channel(8) << 8) | channel(0)
}

export const mod = (n: number, m: number): number => ((n % m) + m) % m

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const sextet = (word: number, shift: number): string => BASE64[(word >> shift) & 63] ?? ''

export const base64Of = (bytes: Uint8Array): string => {
  let out = ''
  let i = 0
  const at = (index: number): number => bytes[index] ?? 0
  for (; i + 2 < bytes.length; i += 3) {
    const w = (at(i) << 16) | (at(i + 1) << 8) | at(i + 2)
    out += sextet(w, 18) + sextet(w, 12) + sextet(w, 6) + sextet(w, 0)
  }
  const rest = bytes.length - i
  if (rest === 1) {
    const w = at(i) << 16
    out += `${sextet(w, 18)}${sextet(w, 12)}==`
  } else if (rest === 2) {
    const w = (at(i) << 16) | (at(i + 1) << 8)
    out += `${sextet(w, 18)}${sextet(w, 12)}${sextet(w, 6)}=`
  }
  return out
}

const pools = new Map<number, Uint32Array>()
const MAX_POOLS = 8

type NativeBase64 = { toBase64?: () => string }

// The Raster element takes cells as little-endian u32 triples, base64-encoded.
// Why pooled: a scene packs every tick, so one buffer per size is reused instead of allocated.
export const cellsOf = (grid: readonly (readonly number[])[]): string => {
  const length = grid.length * 3
  let words = pools.get(length)
  if (words === undefined) {
    if (pools.size >= MAX_POOLS) {
      pools.clear()
    }
    words = new Uint32Array(length)
    pools.set(length, words)
  }
  for (let i = 0; i < grid.length; i += 1) {
    const cell = grid[i]
    words[i * 3] = cell?.[0] ?? 0
    words[i * 3 + 1] = cell?.[1] ?? 0
    words[i * 3 + 2] = cell?.[2] ?? 0
  }
  const bytes = new Uint8Array(words.buffer, 0, length * 4)
  const native = (bytes as Uint8Array & NativeBase64).toBase64
  return typeof native === 'function' ? native.call(bytes) : base64Of(bytes)
}

export const glyphCell = (glyph: string, color: number, background: number): number[] => [
  glyph.codePointAt(0) ?? 0x20,
  color,
  background
]

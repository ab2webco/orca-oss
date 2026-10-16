// FNV-1a over a packed grid: pins a frame without storing its pixels.
export const digest = (grid: readonly (readonly number[])[]): string => {
  let h = 0x811c9dc5
  for (const value of grid.flat()) {
    h ^= value
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

export const glyphs = (grid: readonly (readonly number[])[]): string =>
  grid.map((one) => (one[0] === 0x2580 ? '' : String.fromCodePoint(one[0] ?? 0))).join('')

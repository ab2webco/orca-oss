// East Asian wide and fullwidth blocks, plus the emoji planes terminals draw two cells wide.
const WIDE: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x3fffd]
]

const glyphWidthOf = (code: number): number => {
  if (code >= 0x300 && code < 0x370) {
    return 0
  }
  return WIDE.some(([from, to]) => code >= from && code <= to) ? 2 : 1
}

/** Terminal cells a string takes. */
export const cellWidthOf = (text: string): number =>
  Array.from(text).reduce((sum, glyph) => sum + glyphWidthOf(glyph.codePointAt(0) ?? 0), 0)

/** The text cut to `room` cells, ending in an ellipsis when anything was cut. */
export const fitCells = (text: string, room: number): string => {
  if (cellWidthOf(text) <= room) {
    return text
  }
  if (room <= 0) {
    return ''
  }
  let kept = ''
  let width = 0
  for (const glyph of text) {
    const next = glyphWidthOf(glyph.codePointAt(0) ?? 0)
    if (width + next > room - 1) {
      break
    }
    kept += glyph
    width += next
  }
  return `${kept}…`
}

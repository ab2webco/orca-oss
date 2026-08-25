import type { IBuffer, IBufferCell } from '@xterm/headless'
import {
  coalesceTerminalLineSegments,
  terminalLineColorForAnsiIndex,
  terminalLineColorForRgb,
  type TerminalLineColor,
  type TerminalLineSegment
} from '../../shared/terminal-line-segments'

/**
 * A cell's foreground as one of the eight tones the grid paints.
 *
 * Order matters: `isFgDefault` first, because a cell can carry attributes with
 * no colour of its own. The RGB arm is the one ORCA-296 added — it used to fall
 * through to `undefined`, which the mapper reads as 'default', so every
 * truecolor span in an agent pane rendered white.
 */
function cellForegroundColor(cell: IBufferCell): TerminalLineColor {
  if (cell.isFgDefault()) {
    return 'default'
  }
  if (cell.isFgPalette()) {
    return terminalLineColorForAnsiIndex(cell.getFgColor())
  }
  if (cell.isFgRGB()) {
    // In RGB mode getFgColor() is packed 0xRRGGBB, not an index.
    return terminalLineColorForRgb(cell.getFgColor())
  }
  return 'default'
}

/**
 * First row of the tail window.
 *
 * Anchored on the cursor, not on `buffer.length`: a pane's grid can be taller
 * than the window (the agent grid forwards a tall viewport), and `length` is then
 * the whole grid while the content sits at its top. Ending the window at the
 * buffer's end walked past every written row and returned nothing — a tail that
 * read blank for an idle pane while its plain-text twin, which has a renderer
 * fallback, kept working (ORCA-285).
 */
function tailWindow(buffer: IBuffer, limit: number): { start: number; end: number } {
  const rows = Math.max(0, Math.floor(limit))
  // +1 so the cursor's own row is inside the window: it holds the live prompt.
  const end = Math.min(buffer.baseY + buffer.cursorY + 1, buffer.length)
  return { start: Math.max(0, end - rows), end }
}

/**
 * Tail rows of a terminal buffer as coloured runs.
 *
 * Why cells and not a serialize(): the ANSI string would have to be parsed again
 * by whoever renders it, and an escape that survived would print literally in a
 * DOM text node (ORCA-234).
 */
export function readBufferTailSegments(buffer: IBuffer, limit: number): TerminalLineSegment[][] {
  const { start, end } = tailWindow(buffer, limit)
  const rows: TerminalLineSegment[][] = []
  const cell = buffer.getNullCell()
  for (let row = start; row < end; row += 1) {
    const line = buffer.getLine(row)
    if (!line) {
      rows.push([])
      continue
    }
    const runs: TerminalLineSegment[] = []
    for (let column = 0; column < line.length; column += 1) {
      line.getCell(column, cell)
      const chars = cell.getChars()
      // A wide character's trailing cell reports no width and no chars.
      if (chars === '' && cell.getWidth() === 0) {
        continue
      }
      runs.push({
        text: chars === '' ? ' ' : chars,
        color: cellForegroundColor(cell),
        bold: cell.isBold() !== 0,
        dim: cell.isDim() !== 0
      })
    }
    rows.push(coalesceTerminalLineSegments(runs))
  }
  return rows
}

/** Tail rows as plain text, for callers that do not paint colour. */
export function readBufferTailLines(buffer: IBuffer, limit: number): string[] {
  const { start, end } = tailWindow(buffer, limit)
  const lines: string[] = []
  for (let row = start; row < end; row += 1) {
    lines.push(buffer.getLine(row)?.translateToString(true) ?? '')
  }
  return lines
}

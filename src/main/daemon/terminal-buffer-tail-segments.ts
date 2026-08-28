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

function isBlankRow(buffer: IBuffer, row: number): boolean {
  return (buffer.getLine(row)?.translateToString(true) ?? '').trim().length === 0
}

function hasContentOnScreen(buffer: IBuffer, end: number): boolean {
  for (let row = Math.max(0, buffer.baseY); row < end; row += 1) {
    if (!isBlankRow(buffer, row)) {
      return true
    }
  }
  return false
}

/**
 * Rows the tail window returns, oldest first.
 *
 * Anchored on the cursor, not on `buffer.length`: a pane's grid can be taller
 * than the window (the agent grid forwards a tall viewport), and `length` is then
 * the whole grid while the content sits at its top. Ending the window at the
 * buffer's end walked past every written row and returned nothing — a tail that
 * read blank for an idle pane while its plain-text twin, which has a renderer
 * fallback, kept working (ORCA-285).
 *
 * Blank rows do not consume the budget. A TUI parks its composer at the foot and
 * leaves the screen above it empty, so the rows immediately before the cursor are
 * that gap and the conversation sits above it — the window rendered a nearly
 * empty cell while the terminal showed a full screen (ORCA-306).
 */
function tailRows(buffer: IBuffer, limit: number): number[] {
  const rows = Math.max(0, Math.floor(limit))
  // +1 so the cursor's own row is inside the window: it holds the live prompt.
  const end = Math.min(buffer.baseY + buffer.cursorY + 1, buffer.length)
  if (rows === 0 || end <= 0) {
    return []
  }
  const anchored = Math.max(0, end - rows)
  // Why only when the screen has something on it: a pane whose screen is empty
  // is empty, and walking up would present its scrollback as the current view.
  // Why one screen of headroom: a gap a TUI draws cannot outgrow the screen it
  // draws on, and an unbounded walk would read the whole scrollback each poll.
  const floor = hasContentOnScreen(buffer, end)
    ? Math.max(0, anchored - Math.max(0, buffer.length - buffer.baseY))
    : anchored
  const selected: number[] = []
  for (let row = end - 1; row >= floor && selected.length < rows; row -= 1) {
    if (isBlankRow(buffer, row)) {
      continue
    }
    selected.push(row)
  }
  return selected.toReversed()
}

/**
 * Tail rows of a terminal buffer as coloured runs.
 *
 * Why cells and not a serialize(): the ANSI string would have to be parsed again
 * by whoever renders it, and an escape that survived would print literally in a
 * DOM text node (ORCA-234).
 */
export function readBufferTailSegments(buffer: IBuffer, limit: number): TerminalLineSegment[][] {
  const rows: TerminalLineSegment[][] = []
  const cell = buffer.getNullCell()
  for (const row of tailRows(buffer, limit)) {
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

/** Tail rows as plain text, for callers that do not paint colour. Blank rows are
 *  skipped, so the result is up to `limit` rows that carry something. */
export function readBufferTailLines(buffer: IBuffer, limit: number): string[] {
  return tailRows(buffer, limit).map((row) => buffer.getLine(row)?.translateToString(true) ?? '')
}

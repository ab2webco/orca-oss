import type { IBuffer } from '@xterm/headless'
import {
  coalesceTerminalLineSegments,
  terminalLineColorForAnsiIndex,
  type TerminalLineSegment
} from '../../shared/terminal-line-segments'

/**
 * Tail rows of a terminal buffer as coloured runs.
 *
 * Why cells and not a serialize(): the ANSI string would have to be parsed again
 * by whoever renders it, and an escape that survived would print literally in a
 * DOM text node (ORCA-234).
 */
export function readBufferTailSegments(buffer: IBuffer, limit: number): TerminalLineSegment[][] {
  const start = Math.max(0, buffer.length - Math.max(0, Math.floor(limit)))
  const rows: TerminalLineSegment[][] = []
  const cell = buffer.getNullCell()
  for (let row = start; row < buffer.length; row += 1) {
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
        color: cell.isFgDefault()
          ? 'default'
          : terminalLineColorForAnsiIndex(cell.isFgPalette() ? cell.getFgColor() : undefined),
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
  const start = Math.max(0, buffer.length - Math.max(0, Math.floor(limit)))
  const lines: string[] = []
  for (let row = start; row < buffer.length; row += 1) {
    lines.push(buffer.getLine(row)?.translateToString(true) ?? '')
  }
  return lines
}

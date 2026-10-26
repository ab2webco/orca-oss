import type { IBufferCell, IBufferCellPosition, Terminal } from '@xterm/xterm'

export type SelectionTextTerminal = Pick<
  Terminal,
  'getSelection' | 'getSelectionPosition' | 'buffer' | 'rows' | 'cols'
>

type ClaudeDock = { borderColumn: number; ruleRow: number }

// Claude Code's fullscreen layout docks a mod Pane (the Orca Game Panel) beside the transcript in
// the same grid: a `│` from the top row down to the full-width `─` rule over the prompt, with the
// pane's `✕` on that top row. Read from the frame at copy time, so a dragged dock width still fits.
function claudeDockOf(terminal: SelectionTextTerminal): ClaudeDock | null {
  const buffer = terminal.buffer.active
  if (buffer.type !== 'alternate') {
    return null
  }
  const top = buffer.viewportY
  let cell: IBufferCell | undefined
  const charAt = (y: number, x: number): string => {
    cell = buffer.getLine(y)?.getCell(x, cell)
    return cell?.getChars() ?? ''
  }
  let ruleRow = -1
  for (let y = top + 1; y < top + terminal.rows && ruleRow < 0; y++) {
    let x = 0
    while (x < terminal.cols && charAt(y, x) === '─') {
      x++
    }
    ruleRow = x === terminal.cols ? y : -1
  }
  let closeMark = terminal.cols - 1
  while (closeMark > 0 && charAt(top, closeMark) !== '✕') {
    closeMark--
  }
  if (ruleRow < 0 || closeMark === 0) {
    return null
  }
  for (let x = 1; x < closeMark; x++) {
    let y = top
    while (y < ruleRow && charAt(y, x) === '│') {
      y++
    }
    if (y === ruleRow) {
      return { borderColumn: x, ruleRow }
    }
  }
  return null
}

/** The selection as a copy takes it, less a docked Claude Code pane's padding, border and body. */
export function terminalSelectionText(terminal: SelectionTextTerminal): string {
  const selection = terminal.getSelection()
  if (!selection) {
    return selection
  }
  return transcriptSelectionOf(terminal, selection) ?? selection
}

function transcriptSelectionOf(terminal: SelectionTextTerminal, selection: string): string | null {
  const range = terminal.getSelectionPosition()
  const dock = range ? claudeDockOf(terminal) : null
  if (!range || !dock) {
    return null
  }
  const [start, end] = isBefore(range.end, range.start)
    ? [range.end, range.start]
    : [range.start, range.end]
  if (start.x >= dock.borderColumn) {
    return null
  }
  const buffer = terminal.buffer.active
  const linesOf = (isClipped: boolean): string[] => {
    const lines: string[] = []
    for (let y = start.y; y <= end.y; y++) {
      const line = buffer.getLine(y)
      const to = y === end.y ? end.x : terminal.cols
      const isBesideDock = isClipped && y < dock.ruleRow
      const cells =
        line?.translateToString(
          true,
          y === start.y ? start.x : 0,
          isBesideDock ? Math.min(to, dock.borderColumn) : to
        ) ?? ''
      // Why: Claude Code paints its layout padding as space cells, which xterm's trim keeps.
      const text = isBesideDock ? cells.trimEnd() : cells
      if (y > start.y && line?.isWrapped) {
        lines[lines.length - 1] += text
      } else {
        lines.push(text)
      }
    }
    return lines
  }
  const newline = selection.includes('\r\n') ? '\r\n' : '\n'
  // Why: rewrite only a row selection rebuilt exactly as xterm took it; a block one is already cut.
  if (linesOf(false).join(newline) !== selection) {
    return null
  }
  return linesOf(true).join(newline)
}

function isBefore(a: IBufferCellPosition, b: IBufferCellPosition): boolean {
  return a.y < b.y || (a.y === b.y && a.x < b.x)
}

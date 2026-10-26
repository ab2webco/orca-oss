import { Terminal as HeadlessTerminal } from '@xterm/headless'
import type { IBuffer, IBufferCellPosition } from '@xterm/xterm'
import { describe, expect, it, vi } from 'vitest'
import captures from './__fixtures__/claude-dock-captures.json'
import { terminalSelectionText, type SelectionTextTerminal } from './claude-dock-selection'
import type { ManagedPane } from '@/lib/pane-manager/pane-manager'
import { copyTerminalPaneMenuSelection } from './terminal-pane-menu-copy-actions'
import { copyTerminalSelection } from './terminal-selection-copy'

type Capture = { cols: number; rows: number; lines: string[] }
type Range = { start: IBufferCellPosition; end: IBufferCellPosition }

// Real Claude Code 2.1.310 screens with the orca-game mod, 169 columns (1440px) and 89 (768px).
async function paint(capture: Capture, { altScreen = true } = {}): Promise<HeadlessTerminal> {
  const terminal = new HeadlessTerminal({
    cols: capture.cols,
    rows: capture.rows,
    allowProposedApi: true
  })
  const rows = capture.lines.map((line, index) => `\x1b[${index + 1};1H${line}`).join('')
  await new Promise<void>((resolve) =>
    terminal.write(`${altScreen ? '\x1b[?1049h' : ''}${rows}`, resolve)
  )
  return terminal
}

// Mirrors xterm's linear SelectionService.selectionText: the text a copy took before this fix.
function xtermSelectionOf(buffer: IBuffer, { start, end }: Range, newline = '\n'): string {
  const text = (y: number, from: number, to?: number) =>
    buffer.getLine(y)?.translateToString(true, from, to) ?? ''
  const lines = [text(start.y, start.x, start.y === end.y ? end.x : undefined)]
  for (let y = start.y + 1; y <= end.y; y++) {
    const next = text(y, 0, y === end.y ? end.x : undefined)
    if (buffer.getLine(y)?.isWrapped) {
      lines[lines.length - 1] += next
    } else {
      lines.push(next)
    }
  }
  return lines.join(newline)
}

function selecting(
  terminal: HeadlessTerminal,
  range: Range,
  selection = xtermSelectionOf(terminal.buffer.active as IBuffer, range)
): SelectionTextTerminal {
  return {
    buffer: terminal.buffer as SelectionTextTerminal['buffer'],
    rows: terminal.rows,
    cols: terminal.cols,
    getSelection: () => selection,
    getSelectionPosition: () => range
  }
}

function cellOf(capture: Capture, text: string, offset = 0): IBufferCellPosition {
  const y = capture.lines.findIndex((line) => line.includes(text) && !line.includes('printf'))
  return { x: capture.lines[y].indexOf(text) + offset, y }
}

// The tool-output gutter indents the later rows; that indent is the chat's, so it stays.
const COMMANDS = 'git fetch origin\n     git rebase origin/main\n     git push --force-with-lease'

// The drag from the report: from the first command to past the end of the last one.
function commandDrag(capture: Capture, endX?: number): Range {
  const end = cellOf(capture, 'git push --force-with-lease', 'git push --force-with-lease'.length)
  return { start: cellOf(capture, 'git fetch origin'), end: { x: endX ?? end.x, y: end.y } }
}

describe('terminalSelectionText with a docked Claude Code pane', () => {
  it.each([
    ['the Panel at 1440', captures.panel1440],
    ['the Panel in zen mode at 1440', captures.panelZen1440]
  ])('copies only the chat text beside %s', async (_name, capture) => {
    const terminal = await paint(capture)
    const range = commandDrag(capture)
    expect(xtermSelectionOf(terminal.buffer.active as IBuffer, range)).toContain('│')

    expect(terminalSelectionText(selecting(terminal, range))).toBe(COMMANDS)
  })

  it('drops the Panel when the drag ends inside it', async () => {
    const terminal = await paint(captures.panel1440)
    const range = commandDrag(captures.panel1440, captures.panel1440.cols - 4)

    expect(terminalSelectionText(selecting(terminal, range))).toBe(COMMANDS)
  })

  it('keeps the band row text and its own mark, not the border', async () => {
    const capture = captures.panel1440
    const terminal = await paint(capture)
    const range = { start: cellOf(capture, 'Team ·'), end: cellOf(capture, '▤ Panel', 36) }

    expect(terminalSelectionText(selecting(terminal, range))).toBe(
      `Team · loading…${' '.repeat(74)}[-]\n ▤ Panel   ↻ Refresh   ≡ Text   ♥ Pet`
    )
  })

  it('keeps the Windows line ending xterm used', async () => {
    const terminal = await paint(captures.panel1440)
    const range = commandDrag(captures.panel1440)
    const selection = xtermSelectionOf(terminal.buffer.active as IBuffer, range, '\r\n')

    expect(terminalSelectionText(selecting(terminal, range, selection))).toBe(
      COMMANDS.replaceAll('\n', '\r\n')
    )
  })

  it('reaches the clipboard through copyTerminalSelection', async () => {
    const terminal = await paint(captures.panel1440)
    const writeClipboardText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue()
    const selection = selecting(terminal, commandDrag(captures.panel1440))

    await copyTerminalSelection({
      terminal: { ...selection, clearSelection: vi.fn() },
      writeClipboardText
    })

    expect(writeClipboardText).toHaveBeenCalledWith(COMMANDS)
  })

  it('reaches the clipboard through the context-menu copy', async () => {
    const terminal = await paint(captures.panel1440)
    const writeTerminalClipboardText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue()
    vi.stubGlobal('window', { api: { ui: { writeTerminalClipboardText } } })
    const selection = selecting(terminal, commandDrag(captures.panel1440))

    await copyTerminalPaneMenuSelection({
      terminal: { ...selection, focus: vi.fn() }
    } as unknown as ManagedPane)

    vi.unstubAllGlobals()
    expect(writeTerminalClipboardText).toHaveBeenCalledWith(COMMANDS)
  })
})

describe('terminalSelectionText with no docked pane', () => {
  it.each([
    ['the band alone at 1440', captures.band1440],
    ['the game off at 1440', captures.off1440],
    ['the Panel inline at 768', captures.panel768]
  ])('leaves the copy unchanged for %s', async (_name, capture) => {
    const terminal = await paint(capture)
    const range = commandDrag(capture, capture.cols - 1)
    const selection = xtermSelectionOf(terminal.buffer.active as IBuffer, range)

    expect(terminalSelectionText(selecting(terminal, range))).toBe(selection)
  })

  it('leaves the inline Panel box the person selected', async () => {
    const capture = captures.panel768
    const terminal = await paint(capture)
    const range = { start: { x: 0, y: 15 }, end: { x: capture.cols, y: 24 } }
    const selection = xtermSelectionOf(terminal.buffer.active as IBuffer, range)
    expect(selection).toContain('╰')

    expect(terminalSelectionText(selecting(terminal, range))).toBe(selection)
  })

  it('leaves the same rows on the normal screen, as a printed table', async () => {
    const terminal = await paint(captures.panel1440, { altScreen: false })
    const range = commandDrag(captures.panel1440)
    const selection = xtermSelectionOf(terminal.buffer.active as IBuffer, range)

    expect(terminalSelectionText(selecting(terminal, range))).toBe(selection)
  })

  it('leaves a full-height table border that has no close mark', async () => {
    const capture = {
      ...captures.panel1440,
      lines: captures.panel1440.lines.map((line, y) => (y === 0 ? line.replace('✕', ' ') : line))
    }
    const terminal = await paint(capture)
    const range = commandDrag(capture)
    const selection = xtermSelectionOf(terminal.buffer.active as IBuffer, range)

    expect(terminalSelectionText(selecting(terminal, range))).toBe(selection)
  })

  it('leaves a selection that starts inside the Panel', async () => {
    const capture = captures.panel1440
    const terminal = await paint(capture)
    const range = { start: cellOf(capture, 'Fleet'), end: cellOf(capture, '✕ Close', 7) }
    const selection = xtermSelectionOf(terminal.buffer.active as IBuffer, range)

    expect(terminalSelectionText(selecting(terminal, range))).toBe(selection)
  })

  it('leaves a block selection, which xterm already cut to the chosen columns', async () => {
    const terminal = await paint(captures.panel1440)
    const range = commandDrag(captures.panel1440)

    expect(terminalSelectionText(selecting(terminal, range, 'origin\nbase o'))).toBe(
      'origin\nbase o'
    )
  })
})

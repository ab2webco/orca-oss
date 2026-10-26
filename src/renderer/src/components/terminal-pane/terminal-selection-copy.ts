import type { Terminal } from '@xterm/xterm'
import { terminalSelectionText, type SelectionTextTerminal } from './claude-dock-selection'

type TerminalSelectionCopyOptions = {
  terminal: SelectionTextTerminal & Pick<Terminal, 'clearSelection'>
  writeClipboardText: (text: string) => Promise<void>
  clearSelectionOnSuccess?: boolean
}

export async function copyTerminalSelection({
  terminal,
  writeClipboardText,
  clearSelectionOnSuccess = false
}: TerminalSelectionCopyOptions): Promise<boolean> {
  const selection = terminalSelectionText(terminal)
  if (!selection) {
    return false
  }

  await writeClipboardText(selection)
  // Keep failed-copy text selected for retry.
  if (clearSelectionOnSuccess) {
    terminal.clearSelection()
  }
  return true
}

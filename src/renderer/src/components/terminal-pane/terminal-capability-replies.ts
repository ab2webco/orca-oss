import type { IDisposable, IParser, Terminal } from '@xterm/xterm'
import {
  sendTerminalOscColorQueryReplies as sendTerminalOscColorQueryRepliesForColors,
  terminalOscColorQueryReplies,
  terminalOscColorQuerySlotsForBody,
  type TerminalOscColorQuerySlot
} from '../../../../shared/terminal-osc-color-reply'
import { guardParserHandler } from './terminal-parser-handler-guard'

export const DEFAULT_DA1_RESPONSE = '\x1b[?1;2c'
export const CONPTY_DA1_RESPONSE = '\x1b[?61;4c'

type TerminalCapabilityRepliesDeps = {
  terminal: Pick<Terminal, 'cols' | 'rows' | 'element' | 'options'>
  parser: Pick<IParser, 'registerCsiHandler' | 'registerOscHandler'>
  sendInput: (data: string) => boolean | void
  isReplaying: () => boolean
  da1Response?: string
}

function isPrimaryDeviceAttributesQuery(params: (number | number[])[]): boolean {
  return params.length === 0 || (params.length === 1 && params[0] === 0)
}

function getTerminalScreenElement(
  terminal: Pick<Terminal, 'element'>
): Pick<HTMLElement, 'getBoundingClientRect'> | null {
  if (typeof terminal.element?.querySelector !== 'function') {
    return null
  }
  return terminal.element.querySelector('.xterm-screen') ?? null
}

function measureCellPixels(
  terminal: Pick<Terminal, 'cols' | 'rows' | 'element'>
): { width: number; height: number } | null {
  if (terminal.cols <= 0 || terminal.rows <= 0) {
    return null
  }
  const rect = getTerminalScreenElement(terminal)?.getBoundingClientRect()
  if (!rect || !(rect.width > 0) || !(rect.height > 0)) {
    return null
  }
  return {
    width: Math.max(1, Math.round(rect.width / terminal.cols)),
    height: Math.max(1, Math.round(rect.height / terminal.rows))
  }
}

function disposeAll(disposables: IDisposable[]): void {
  for (const disposable of disposables) {
    disposable.dispose()
  }
}

export function sendTerminalOscColorQueryReplies(
  data: string,
  terminal: Pick<Terminal, 'options'>,
  sendInput: (data: string) => boolean | void
): boolean {
  return sendTerminalOscColorQueryRepliesForColors(data, terminal.options.theme ?? {}, sendInput)
}

function sendTerminalOscColorQueryRepliesForSlots(
  slots: readonly TerminalOscColorQuerySlot[],
  terminal: Pick<Terminal, 'options'>,
  sendInput: (data: string) => boolean | void
): boolean {
  const replies = terminalOscColorQueryReplies(terminal.options.theme ?? {}, slots)
  if (!replies) {
    return false
  }
  for (const reply of replies) {
    sendInput(reply)
  }
  return true
}

// 14t (window, px) and 16t (cell, px); anything else (e.g. 18t) is left for xterm's default handling.
function pixelSizeReplyKind(params: (number | number[])[]): 'window' | 'cell' | null {
  if (params.length !== 1) {
    return null
  }
  if (params[0] === 14) {
    return 'window'
  }
  if (params[0] === 16) {
    return 'cell'
  }
  return null
}

export function installTerminalCapabilityReplyHandlers(
  deps: TerminalCapabilityRepliesDeps
): IDisposable {
  const disposables = [
    deps.parser.registerCsiHandler(
      { final: 'c' },
      guardParserHandler('csi-da1', (params) => {
        if (!isPrimaryDeviceAttributesQuery(params)) {
          return false
        }
        // Why: restored scrollback may contain old DA1 queries; answering those
        // into the fresh shell recreates the stray-input leak this handler fixes.
        if (!deps.isReplaying()) {
          deps.sendInput(deps.da1Response ?? DEFAULT_DA1_RESPONSE)
        }
        return true
      })
    ),
    deps.parser.registerOscHandler(
      10,
      guardParserHandler('osc-10-color-query', (data) => {
        const slots = terminalOscColorQuerySlotsForBody(10, data.trim())
        if (!slots) {
          return false
        }
        if (deps.isReplaying()) {
          return true
        }
        return sendTerminalOscColorQueryRepliesForSlots(slots, deps.terminal, deps.sendInput)
      })
    ),
    deps.parser.registerOscHandler(
      11,
      guardParserHandler('osc-11-color-query', (data) => {
        const slots = terminalOscColorQuerySlotsForBody(11, data.trim())
        if (!slots) {
          return false
        }
        if (deps.isReplaying()) {
          return true
        }
        return sendTerminalOscColorQueryRepliesForSlots(slots, deps.terminal, deps.sendInput)
      })
    ),
    // ORCA-536: answered here (parser pass), not via a raw pre-write scan, so replies
    // land in the same stream-order slot as DA1/OSC/XTVERSION instead of jumping ahead.
    deps.parser.registerCsiHandler(
      { final: 't' },
      guardParserHandler('csi-pixel-size', (params) => {
        const kind = pixelSizeReplyKind(params)
        if (kind === null) {
          return false
        }
        const cell = measureCellPixels(deps.terminal)
        if (!cell) {
          return false
        }
        const reportsWindowPixels = kind === 'window'
        const width = cell.width * (reportsWindowPixels ? deps.terminal.cols : 1)
        const height = cell.height * (reportsWindowPixels ? deps.terminal.rows : 1)
        deps.sendInput(`\x1b[${reportsWindowPixels ? 4 : 6};${height};${width}t`)
        return true
      })
    )
  ]

  return {
    dispose: () => disposeAll(disposables)
  }
}

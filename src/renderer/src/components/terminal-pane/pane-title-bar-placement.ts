import {
  splitTerminalPaneActionsPosition,
  type TerminalPaneActionsPosition
} from '../../../../shared/terminal-pane-actions-position'
import type { PaneTitleOverlayRect } from './TerminalPaneHeaderOverlay'

export type PaneTitleBarPlacement = {
  top: number
  attributes: Record<string, string>
}

/** Only untitled (chromeless) actions move; a titled header bar always owns the top strip. */
export function resolvePaneTitleBarPlacement({
  rect,
  isChromeless,
  position
}: {
  rect: PaneTitleOverlayRect
  isChromeless: boolean
  position: TerminalPaneActionsPosition
}): PaneTitleBarPlacement {
  if (!isChromeless) {
    return { top: rect.top, attributes: {} }
  }
  const { edge, align } = splitTerminalPaneActionsPosition(position)
  return {
    // Why: a bottom strip anchors at the pane's bottom edge; CSS lifts it by its own height.
    top: edge === 'bottom' ? rect.top + rect.height : rect.top,
    attributes: {
      'data-chromeless': '',
      'data-actions-edge': edge,
      'data-actions-align': align
    }
  }
}

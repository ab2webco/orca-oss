export type TerminalPaneActionsEdge = 'top' | 'bottom'
export type TerminalPaneActionsAlign = 'left' | 'center' | 'right'
export type TerminalPaneActionsPosition = `${TerminalPaneActionsEdge}-${TerminalPaneActionsAlign}`

export const DEFAULT_TERMINAL_PANE_ACTIONS_POSITION: TerminalPaneActionsPosition = 'bottom-right'

const POSITIONS: ReadonlySet<string> = new Set<TerminalPaneActionsPosition>([
  'top-left',
  'top-center',
  'top-right',
  'bottom-left',
  'bottom-center',
  'bottom-right'
])

function isTerminalPaneActionsPosition(value: unknown): value is TerminalPaneActionsPosition {
  return typeof value === 'string' && POSITIONS.has(value)
}

/** Why: settings files are hand-editable and older builds never wrote this key. */
export function resolveTerminalPaneActionsPosition(value: unknown): TerminalPaneActionsPosition {
  return isTerminalPaneActionsPosition(value) ? value : DEFAULT_TERMINAL_PANE_ACTIONS_POSITION
}

export function splitTerminalPaneActionsPosition(position: TerminalPaneActionsPosition): {
  edge: TerminalPaneActionsEdge
  align: TerminalPaneActionsAlign
} {
  const [edge, align] = position.split('-') as [TerminalPaneActionsEdge, TerminalPaneActionsAlign]
  return { edge, align }
}

export function composeTerminalPaneActionsPosition(
  edge: TerminalPaneActionsEdge,
  align: TerminalPaneActionsAlign
): TerminalPaneActionsPosition {
  return `${edge}-${align}`
}

import { cellWidthOf, fitCells } from './cell-width'

/** Below this many body columns (a phone) every action is a full-width, two-row button. */
export const TAP_LAYOUT_COLUMNS = 60
export const TAP_ROWS = 2
// The engine draws a Button's hotkey as `2: ` before its label.
export const HOTKEY_CELLS = 3

export const isTapLayout = (columns: number): boolean => columns < TAP_LAYOUT_COLUMNS

/**
 * The label and a blank row under it, padded so the whole block takes a press; `prefix` cells
 * (a hotkey's `q: `) come before the first row only, since the second wraps to the left edge.
 */
export const tapLabelOf = (label: string, columns: number, prefix = 0): string => {
  const width = Math.max(1, columns)
  const room = Math.max(1, width - prefix)
  const line = fitCells(` ${label}`, room)
  return `${line}${' '.repeat(Math.max(0, room - cellWidthOf(line)))}\n${' '.repeat(width)}`
}

/** Up to `max` actions; past it one less, the rest counted for a `+N` button. */
export const tapActionsOf = <T>(
  actions: readonly T[],
  max: number
): { shown: T[]; hidden: number } => {
  if (actions.length <= max) {
    return { shown: [...actions], hidden: 0 }
  }
  const kept = Math.max(0, max - 1)
  return { shown: actions.slice(0, kept), hidden: actions.length - kept }
}

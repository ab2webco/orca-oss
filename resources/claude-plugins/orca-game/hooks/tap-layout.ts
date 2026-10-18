import { cellWidthOf } from './cell-width'
import { chipRowsOf, type Chip, type PlacedChip } from './chip-rows'

/** Below this many body columns (a phone) every action is a three-row chip. */
export const TAP_LAYOUT_COLUMNS = 60
// The phone's xterm cell is 7.8 x 15 px at 13 px: 3 rows are 45 px and 6 cells 47 px, over 44 pt.
export const TAP_ROWS = 3
export const TAP_MIN_CELLS = 6
// The engine draws a Button's hotkey as `2: ` before its label.
export const HOTKEY_CELLS = 3
// A chip pads its label with one space on each side.
const PAD = 2

export const isTapLayout = (columns: number): boolean => columns < TAP_LAYOUT_COLUMNS

// A short label is centred in spaces up to the chip's least width.
const paddedOf = (label: string): string => {
  const room = TAP_MIN_CELLS - PAD - cellWidthOf(label)
  if (room <= 0) {
    return label
  }
  const left = Math.floor(room / 2)
  return `${' '.repeat(left)}${label}${' '.repeat(room - left)}`
}

/** The label on the middle of three rows, each `width` cells; a hotkey's `prefix` cells start row one. */
export const tapChipOf = (label: string, width: number, prefix = 0): string => {
  const middle = ` ${label}`
  const blank = ' '.repeat(width)
  return [
    ' '.repeat(Math.max(0, width - prefix)),
    `${middle}${' '.repeat(Math.max(0, width - cellWidthOf(middle)))}`,
    blank
  ].join('\n')
}

export type TapRowsOptions = { columns: number; maxRows?: number; more?: (count: number) => string }

/** Chips at least six cells wide in rows that fit `columns`; past `maxRows`, `chipRowsOf`'s `+N`. */
export const tapRowsOf = (
  chips: readonly Chip[],
  { columns, maxRows = Number.MAX_SAFE_INTEGER, more }: TapRowsOptions
): PlacedChip[][] =>
  chipRowsOf(
    chips.map((chip) => ({
      ...chip,
      labels: chip.labels.map(paddedOf) as [string, ...string[]]
    })),
    {
      columns,
      maxRows,
      ...(more === undefined ? {} : { more: (count: number) => paddedOf(more(count)) })
    }
  )

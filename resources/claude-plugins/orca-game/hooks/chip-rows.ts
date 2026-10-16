import { cellWidthOf, fitCells } from './cell-width'

export const MORE_CHIP_KEY = 'chip-more'
// Every chip pads its label with one space on each side.
const PAD = 2

/** A chip's labels run from its full one to its shortest; a lower priority is kept longer. */
export type Chip = { key: string; priority: number; labels: readonly [string, ...string[]] }

export type PlacedChip = { key: string; label: string; width: number }

export type ChipRowsOptions = {
  columns: number
  maxRows: number
  /** The label counting dropped chips; without it no chip is dropped. */
  more?: (count: number) => string
}

const place = (key: string, label: string, columns: number): PlacedChip => {
  const fitted = fitCells(label, columns - PAD)
  return { key, label: fitted, width: cellWidthOf(fitted) + PAD }
}

const pack = (chips: readonly PlacedChip[], columns: number): PlacedChip[][] => {
  const rows: PlacedChip[][] = []
  let row: PlacedChip[] = []
  let width = 0
  for (const chip of chips) {
    const next = row.length === 0 ? chip.width : width + 1 + chip.width
    if (row.length > 0 && next > columns) {
      rows.push(row)
      row = [chip]
      width = chip.width
    } else {
      row.push(chip)
      width = next
    }
  }
  return row.length > 0 ? [...rows, row] : rows
}

// The least important chip, the later one among equals.
const leastOf = (indexes: readonly number[], chips: readonly Chip[]): number | undefined =>
  indexes.reduce<number | undefined>(
    (worst, at) =>
      worst === undefined || (chips[at]?.priority ?? 0) >= (chips[worst]?.priority ?? 0)
        ? at
        : worst,
    undefined
  )

/** Whole chips in rows that fit `columns`: shorter labels first, then a `+N` for those dropped. */
export const chipRowsOf = (
  chips: readonly Chip[],
  { columns, maxRows, more }: ChipRowsOptions
): PlacedChip[][] => {
  const steps = chips.map(() => 0)
  const placed = (kept: readonly number[], extra: PlacedChip[] = []): PlacedChip[] => [
    ...kept.flatMap((at) => {
      const chip = chips[at]
      return chip === undefined
        ? []
        : [place(chip.key, chip.labels[steps[at] ?? 0] ?? chip.labels[0], columns)]
    }),
    ...extra
  ]
  let kept = chips.map((_, at) => at)
  let rows = pack(placed(kept), columns)
  while (rows.length > maxRows) {
    const shorter = kept.filter((at) => (steps[at] ?? 0) < (chips[at]?.labels.length ?? 1) - 1)
    const at = leastOf(shorter, chips)
    if (at === undefined) {
      break
    }
    steps[at] = (steps[at] ?? 0) + 1
    rows = pack(placed(kept), columns)
  }
  if (more === undefined) {
    return rows
  }
  while (rows.length > maxRows && kept.length > 1) {
    const at = leastOf(kept, chips)
    kept = kept.filter((one) => one !== at)
    const count = place(MORE_CHIP_KEY, more(chips.length - kept.length), columns)
    rows = pack(placed(kept, [count]), columns)
  }
  return rows
}

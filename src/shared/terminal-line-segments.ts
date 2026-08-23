// A terminal line split into runs that share a colour (ORCA-234).
//
// Why segments and not ANSI on the wire: the grid cell renders text nodes, so an
// escape that reached the renderer would print literally. Emitting runs keeps
// every escape inside main, which is where the emulator already lives.

/** Palette slot; the renderer resolves it against the theme. */
export type TerminalLineColor =
  | 'default'
  | 'black'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'white'

export type TerminalLineSegment = {
  text: string
  color: TerminalLineColor
  bold: boolean
  dim: boolean
}

/** Past this a line stops being scannable and the payload stops being small. */
export const TERMINAL_LINE_MAX_SEGMENTS = 24

/** xterm's ANSI palette indexes, in order. Bright maps onto the same slot. */
const PALETTE: TerminalLineColor[] = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white'
]

/** The slot for an xterm palette index, or null when it carries no colour. */
export function terminalLineColorForAnsiIndex(index: number | undefined): TerminalLineColor {
  if (typeof index !== 'number' || index < 0) {
    return 'default'
  }
  // 0-7 plain, 8-15 bright: same hue, and the cell is too small to distinguish
  // a second set of eight.
  return PALETTE[index % 8] ?? 'default'
}

/**
 * Merges neighbouring runs that share a style and drops trailing blanks.
 *
 * Why merge: a per-cell walk emits one run per character, which would send 200
 * objects for a line a reader sees as one colour.
 */
export function coalesceTerminalLineSegments(
  runs: readonly TerminalLineSegment[]
): TerminalLineSegment[] {
  const merged: TerminalLineSegment[] = []
  for (const run of runs) {
    if (!run.text) {
      continue
    }
    const last = merged.at(-1)
    if (last && last.color === run.color && last.bold === run.bold && last.dim === run.dim) {
      last.text += run.text
      continue
    }
    if (merged.length >= TERMINAL_LINE_MAX_SEGMENTS) {
      // Keep the text, lose the styling past the cap: a truncated line reads as
      // missing output, which is worse than a monochrome tail.
      const overflow = merged.at(-1)
      if (overflow) {
        overflow.text += run.text
      }
      continue
    }
    merged.push({ ...run })
  }
  const tail = merged.at(-1)
  if (tail) {
    tail.text = tail.text.replace(/\s+$/, '')
    if (!tail.text) {
      merged.pop()
    }
  }
  return merged
}

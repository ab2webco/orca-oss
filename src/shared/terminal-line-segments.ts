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
 * xterm's own default palette (Tango), slots 0-15, as packed 0xRRGGBB.
 *
 * Why these and not pure primaries: a truecolor cell is classified by nearest
 * neighbour here and then folded with the same `% 8` the palette path uses, so
 * a TUI painting `#cc0000` and one sending SGR 31 land on `red` for the same
 * reason. Picking abstract references instead would let the two paths disagree
 * on the same visible colour. Source: DEFAULT_ANSI_COLORS in
 * `@xterm/xterm/src/browser/Types.ts`.
 */
const PALETTE_RGB: number[] = [
  0x2e3436, 0xcc0000, 0x4e9a06, 0xc4a000, 0x3465a4, 0x75507b, 0x06989a, 0xd3d7cf, 0x555753,
  0xef2929, 0x8ae234, 0xfce94f, 0x729fcf, 0xad7fa8, 0x34e2e2, 0xeeeeec
]

const ALL_SLOTS: number[] = PALETTE_RGB.map((_, index) => index)
/** The palette's greys: black, white and their bright twins. */
const GREY_SLOTS: number[] = [0, 7, 8, 15]
/** Above this max-minus-min the colour carries a hue worth naming. */
const GREY_CHROMA_MAX = 24

/**
 * The slot for a truecolor foreground, packed as 0xRRGGBB.
 *
 * Agents are the whole reason this tail exists and their TUIs paint in 24-bit
 * colour, not in the 16-colour palette — so before ORCA-296 every coloured span
 * in an agent pane fell through to 'default' and the grid read white.
 *
 * Nearest neighbour over all sixteen slots rather than eight, so the bright
 * twins get a chance to win; the result is then folded with the same `% 8` the
 * palette path uses, which makes a bright hue and its plain twin agree exactly
 * as they already do for palette input. Near-greys are handled separately —
 * see the chroma gate below.
 */
export function terminalLineColorForRgb(rgb: number | undefined): TerminalLineColor {
  if (typeof rgb !== 'number' || !Number.isFinite(rgb) || rgb < 0) {
    return 'default'
  }
  const red = (rgb >> 16) & 0xff
  const green = (rgb >> 8) & 0xff
  const blue = rgb & 0xff
  // Greys are decided before distance, not by it. Tango's magenta (#75507b) is
  // desaturated enough that plain #808080 is nearer to it than to either grey
  // slot, so an unrestricted search paints every dim TUI glyph purple. Below
  // this chroma the search is confined to the palette's own four greys, which
  // keeps the answer anchored to the palette instead of to a lightness
  // constant. The threshold sits between the greys (chroma <= 8) and the least
  // saturated hue the palette carries (magenta, 43).
  const chroma = Math.max(red, green, blue) - Math.min(red, green, blue)
  const candidates = chroma < GREY_CHROMA_MAX ? GREY_SLOTS : ALL_SLOTS
  let bestIndex = 0
  let bestDistance = Number.POSITIVE_INFINITY
  for (const index of candidates) {
    const candidate = PALETTE_RGB[index]
    // Squared distance: the comparison only needs the ordering, and skipping the
    // square root keeps this a per-cell integer walk.
    const dr = red - ((candidate >> 16) & 0xff)
    const dg = green - ((candidate >> 8) & 0xff)
    const db = blue - (candidate & 0xff)
    const distance = dr * dr + dg * dg + db * db
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  }
  return PALETTE[bestIndex % 8] ?? 'default'
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

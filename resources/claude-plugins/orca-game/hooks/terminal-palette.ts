// The agent terminal's colours: V30 in dark, the panel's light tokens (main.css) in light.

export type TerminalAppearance = 'dark' | 'light'

export type TerminalPalette = {
  /** A heading's name and phase, and the live line's glyph and name while working. */
  head: string
  /** A heading's time, a tool line, and the live line's verb, timer and step. */
  dim: string
  /** A heading's rule: `head` at .28 over the pane. */
  rule: string
  /** A question heading, `--agent-question-text`. */
  ask: string
  askRule: string
  /** The live line while it waits on the person, and once its turn is done. */
  waiting: string
  done: string
}

const RULE_ALPHA = 0.28

const channelsOf = (hex: string): number[] =>
  [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16))

/** `color` at `alpha` over `under`, as CSS draws a translucent 1 px line. */
export const blendOver = (color: string, alpha: number, under: string): string => {
  const top = channelsOf(color)
  const bottom = channelsOf(under)
  return `#${top
    .map((one, at) =>
      Math.round(one * alpha + (bottom[at] ?? 0) * (1 - alpha))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`
}

const paletteOf = (colors: Omit<TerminalPalette, 'rule' | 'askRule'>, pane: string) => ({
  ...colors,
  rule: blendOver(colors.head, RULE_ALPHA, pane),
  askRule: blendOver(colors.ask, RULE_ALPHA, pane)
})

const PALETTES: Readonly<Record<TerminalAppearance, TerminalPalette>> = {
  dark: paletteOf(
    {
      head: '#e6e8ec',
      dim: '#8b93a1',
      ask: '#ffb7b8',
      waiting: '#ff6568',
      done: '#8fce8f'
    },
    '#23272f'
  ),
  light: paletteOf(
    {
      head: '#0a0a0a',
      dim: '#737373',
      ask: '#b60010',
      waiting: '#e40014',
      done: '#15803d'
    },
    '#ffffff'
  )
}

let appearance: TerminalAppearance = 'dark'

/** Follows Orca's look; true when it changed, so the caller redraws. */
export const setTerminalAppearance = (next: TerminalAppearance): boolean => {
  const isChanged = next !== appearance
  appearance = next
  return isChanged
}

export const terminalPalette = (): TerminalPalette => PALETTES[appearance]

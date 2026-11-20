// The app's design tokens as the arcade canvas paints with them, read from the live theme so a
// theme switch repaints the games without a reload.

export type ArcadeRgb = readonly [number, number, number]

export const ARCADE_TOKEN_NAMES = {
  background: '--background',
  foreground: '--foreground',
  card: '--card',
  muted: '--muted',
  mutedForeground: '--muted-foreground',
  border: '--border',
  ring: '--ring',
  info: '--status-info',
  success: '--status-success',
  warning: '--status-warning',
  attention: '--status-attention',
  violet: '--ai-action-accent',
  magenta: '--agent-tail-magenta',
  cyan: '--agent-tail-cyan'
} as const

export type ArcadeTokenRole = keyof typeof ARCADE_TOKEN_NAMES

export type ArcadeTokens = {
  /** Identifies the theme the colours were read under; a change means repaint and rebake. */
  key: string
  isDark: boolean
  rgb: Record<ArcadeTokenRole, ArcadeRgb>
  /** A role as a canvas colour, optionally translucent. */
  css: (role: ArcadeTokenRole, alpha?: number) => string
}

export const arcadeCssOf = ([r, g, b]: ArcadeRgb, alpha = 1): string =>
  alpha >= 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha})`

/** Tokens from already-resolved colours; the canvas reader and tests both build through here. */
export function arcadeTokensOf(
  key: string,
  isDark: boolean,
  rgb: Record<ArcadeTokenRole, ArcadeRgb>
): ArcadeTokens {
  return { key, isDark, rgb, css: (role, alpha) => arcadeCssOf(rgb[role], alpha) }
}

// Why a 1×1 paint: tokens arrive as oklch, color-mix or var() chains; the canvas resolves them all.
function resolveRgb(probe: CanvasRenderingContext2D, value: string): ArcadeRgb {
  probe.clearRect(0, 0, 1, 1)
  probe.fillStyle = '#000'
  probe.fillStyle = value || '#000'
  probe.fillRect(0, 0, 1, 1)
  const [r = 0, g = 0, b = 0] = probe.getImageData(0, 0, 1, 1).data
  return [r, g, b]
}

let cached: ArcadeTokens | null = null
let probe: CanvasRenderingContext2D | null = null

const themeKeyOf = (root: HTMLElement): string =>
  `${root.className}|${root.getAttribute('style') ?? ''}`

/** The current theme's tokens; cheap per frame, re-read only when the root's theme changes. */
export function arcadeTokens(): ArcadeTokens {
  const root = document.documentElement
  const key = themeKeyOf(root)
  if (cached?.key === key) {
    return cached
  }
  probe ??= document
    .createElement('canvas')
    .getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null
  const style = getComputedStyle(root)
  const rgb = Object.fromEntries(
    Object.entries(ARCADE_TOKEN_NAMES).map(([role, name]) => [
      role,
      probe ? resolveRgb(probe, style.getPropertyValue(name).trim()) : ([0, 0, 0] as const)
    ])
  ) as Record<ArcadeTokenRole, ArcadeRgb>
  cached = arcadeTokensOf(key, root.classList.contains('dark'), rgb)
  return cached
}

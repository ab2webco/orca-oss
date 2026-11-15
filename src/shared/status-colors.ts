// Why: the five status tones keep fixed meanings; users may change only the hue,
// separately per theme because one colour rarely reads on both backgrounds.
export const STATUS_COLOR_TONES = ['attention', 'warning', 'info', 'success', 'idle'] as const

export type StatusColorTone = (typeof STATUS_COLOR_TONES)[number]

export type StatusColorTheme = 'light' | 'dark'

export type StatusColorPalette = Partial<Record<StatusColorTone, string>>

export type StatusColorOverrides = Partial<Record<StatusColorTheme, StatusColorPalette>>

const HEX_COLOR = /^#[0-9a-f]{6}$/i

function normalizePalette(value: unknown): StatusColorPalette | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const palette: StatusColorPalette = {}
  for (const tone of STATUS_COLOR_TONES) {
    const color = (value as Record<string, unknown>)[tone]
    if (typeof color === 'string' && HEX_COLOR.test(color)) {
      palette[tone] = color.toLowerCase()
    }
  }
  return Object.keys(palette).length > 0 ? palette : null
}

/** Keeps only known themes and tones with `#rrggbb` values; the result is safe to inline as CSS. */
export function normalizeStatusColorOverrides(value: unknown): StatusColorOverrides {
  if (!value || typeof value !== 'object') {
    return {}
  }
  const overrides: StatusColorOverrides = {}
  for (const theme of ['light', 'dark'] as const) {
    const palette = normalizePalette((value as Record<string, unknown>)[theme])
    if (palette) {
      overrides[theme] = palette
    }
  }
  return overrides
}

// Why: mirrors the renderer's main.css so Settings can show and check a default without
// reading computed styles that an override would already have replaced.
export const STATUS_COLOR_DEFAULTS: Record<StatusColorTheme, Record<StatusColorTone, string>> = {
  light: {
    attention: '#e40014',
    warning: '#b45309',
    info: '#0369a1',
    success: '#15803d',
    idle: '#737373'
  },
  dark: {
    attention: '#ff6568',
    warning: '#f5b342',
    info: '#4fc3f7',
    success: '#34d399',
    idle: '#a1a1a1'
  }
}

export const STATUS_COLOR_BACKGROUND: Record<StatusColorTheme, string> = {
  light: '#ffffff',
  dark: '#0a0a0a'
}

// Why: the theme warning floor matches the token rule, since tones are also text.
const MIN_CONTRAST = 4.5
// Why: below this RGB distance two tones read as one at dot size (prototype v13).
const MIN_DISTANCE = 48

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [n >> 16, (n >> 8) & 255, n & 255]
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

export type StatusColorWarning = { kind: 'close'; other: StatusColorTone } | { kind: 'contrast' }

/** Too close to another tone wins over low contrast: a twin hue loses meaning outright. */
export function statusColorWarning(
  tone: StatusColorTone,
  palette: Record<StatusColorTone, string>,
  background: string
): StatusColorWarning | null {
  const own = rgb(palette[tone])
  const other = STATUS_COLOR_TONES.find(
    (candidate) =>
      candidate !== tone &&
      Math.hypot(...own.map((v, i) => v - rgb(palette[candidate])[i])) < MIN_DISTANCE
  )
  if (other) {
    return { kind: 'close', other }
  }
  return contrastRatio(palette[tone], background) < MIN_CONTRAST ? { kind: 'contrast' } : null
}

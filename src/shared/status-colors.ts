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

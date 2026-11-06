import { STATUS_TONES, type StatusTone } from '@/components/status-tone'
import {
  normalizeStatusColorOverrides,
  type StatusColorOverrides,
  type StatusColorTheme
} from '../../../shared/status-colors'

// Why: mirrors main.css so Settings can show and check a default without
// reading computed styles that an override would already have replaced.
export const STATUS_COLOR_DEFAULTS: Record<StatusColorTheme, Record<StatusTone, string>> = {
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
    success: '#86efac',
    idle: '#a1a1a1'
  }
}

export const STATUS_COLOR_BACKGROUND: Record<StatusColorTheme, string> = {
  light: '#ffffff',
  dark: '#0a0a0a'
}

const STYLE_ID = 'orca-status-colors'
// Why: the theme warning floor matches the token rule, since tones are also text.
const MIN_CONTRAST = 4.5
// Why: below this RGB distance two tones read as one at dot size (prototype v13).
const MIN_DISTANCE = 48

/** `:root.light` / `:root.dark` outrank main.css's `:root` and `.dark` blocks. */
export function buildStatusColorCss(value: StatusColorOverrides | undefined): string {
  const overrides = normalizeStatusColorOverrides(value)
  return (['light', 'dark'] as const)
    .map((theme) => {
      const palette = overrides[theme]
      if (!palette) {
        return ''
      }
      const declarations = STATUS_TONES.filter((tone) => palette[tone])
        .map((tone) => `--status-${tone}:${palette[tone]};`)
        .join('')
      return `:root.${theme}{${declarations}}`
    })
    .join('')
}

export function applyStatusColorOverrides(
  value: StatusColorOverrides | undefined,
  doc: Document = document
): void {
  const cssText = buildStatusColorCss(value)
  const existing = doc.getElementById(STYLE_ID)
  if (!cssText) {
    existing?.remove()
    return
  }
  const style = existing ?? doc.head.appendChild(doc.createElement('style'))
  style.id = STYLE_ID
  style.textContent = cssText
}

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

export type StatusColorWarning = { kind: 'close'; other: StatusTone } | { kind: 'contrast' }

/** Too close to another tone wins over low contrast: a twin hue loses meaning outright. */
export function statusColorWarning(
  tone: StatusTone,
  palette: Record<StatusTone, string>,
  background: string
): StatusColorWarning | null {
  const own = rgb(palette[tone])
  const other = STATUS_TONES.find(
    (candidate) =>
      candidate !== tone &&
      Math.hypot(...own.map((v, i) => v - rgb(palette[candidate])[i])) < MIN_DISTANCE
  )
  if (other) {
    return { kind: 'close', other }
  }
  return contrastRatio(palette[tone], background) < MIN_CONTRAST ? { kind: 'contrast' } : null
}

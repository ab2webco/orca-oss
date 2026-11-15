import { STATUS_TONES } from '@/components/status-tone'
import {
  normalizeStatusColorOverrides,
  type StatusColorOverrides
} from '../../../shared/status-colors'

const STYLE_ID = 'orca-status-colors'

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

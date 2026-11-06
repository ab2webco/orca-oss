// Why: one colour language for the sidebar, activity bar and cards. Each tone
// has a fixed meaning; only its hue is themeable (docs/STYLEGUIDE.md).
import { STATUS_COLOR_TONES, type StatusColorTone } from '../../../shared/status-colors'

/**
 * attention: needs the user, or failed. warning: at risk, does not need the
 * user yet. info: an agent is working on it now. success: done and verified.
 * idle: idle, or no data.
 */
export type StatusTone = StatusColorTone

export const STATUS_TONES = STATUS_COLOR_TONES

// Why: full literals so Tailwind's scanner emits every class.
const TEXT: Record<StatusTone, string> = {
  attention: 'text-status-attention',
  warning: 'text-status-warning',
  info: 'text-status-info',
  success: 'text-status-success',
  idle: 'text-status-idle'
}

const BG: Record<StatusTone, string> = {
  attention: 'bg-status-attention',
  warning: 'bg-status-warning',
  info: 'bg-status-info',
  success: 'bg-status-success',
  idle: 'bg-status-idle'
}

const BADGE: Record<StatusTone, string> = {
  attention: 'border-status-attention/25 bg-status-attention/5 text-status-attention',
  warning: 'border-status-warning/25 bg-status-warning/5 text-status-warning',
  info: 'border-status-info/25 bg-status-info/5 text-status-info',
  success: 'border-status-success/25 bg-status-success/5 text-status-success',
  idle: 'border-status-idle/25 bg-status-idle/5 text-status-idle'
}

export function statusToneTextClass(tone: StatusTone): string {
  return TEXT[tone]
}

export function statusToneBgClass(tone: StatusTone): string {
  return BG[tone]
}

/** Outline, tint and text for a small badge or inline notice. */
export function statusToneBadgeClass(tone: StatusTone): string {
  return BADGE[tone]
}

import React from 'react'
import { CircleAlert, CircleCheck, CircleSlash } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AgentQuestionIcon } from '@/components/AgentQuestionIcon'
import { AgentWorkingSpinner } from '@/components/AgentWorkingSpinner'
import { statusToneBgClass, statusToneTextClass, type StatusTone } from './status-tone'

export type StatusDotGlyph = 'dot' | 'spinner' | 'question' | 'check' | 'alert' | 'closed'

type StatusDotProps = React.ComponentProps<'span'> & {
  tone: StatusTone
  glyph?: StatusDotGlyph
  /** badge: the 7px cut-out dot that overlays an icon. */
  size?: 'badge' | 'sm' | 'md'
  /** Dims the dot, e.g. idle with nothing open. */
  faded?: boolean
}

const FADED_BG: Record<StatusTone, string> = {
  attention: 'bg-status-attention/40',
  warning: 'bg-status-warning/40',
  info: 'bg-status-info/40',
  success: 'bg-status-success/40',
  idle: 'bg-status-idle/40'
}

const SIZES = {
  badge: { box: 'size-[7px]', inner: 'size-[7px] ring-1 ring-sidebar', icon: 'size-[7px]' },
  sm: { box: 'h-2.5 w-2.5', inner: 'size-1.5', icon: 'size-2.5' },
  md: { box: 'h-3 w-3', inner: 'size-2', icon: 'size-3' }
} as const

/** The one state marker shared by the sidebar, activity bar and cards. */
export const StatusDot = React.memo(function StatusDot({
  tone,
  glyph = 'dot',
  size = 'sm',
  faded = false,
  className,
  ...rest
}: StatusDotProps): React.JSX.Element {
  const { box, inner, icon } = SIZES[size]
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center', box, className)}
      data-status-tone={tone}
      {...rest}
    >
      {glyph === 'spinner' ? (
        <AgentWorkingSpinner className={inner} />
      ) : glyph === 'question' ? (
        <AgentQuestionIcon className={icon} />
      ) : glyph === 'check' ? (
        <CircleCheck className={cn(statusToneTextClass(tone), icon)} aria-hidden="true" />
      ) : glyph === 'alert' ? (
        <CircleAlert className={cn(statusToneTextClass(tone), icon)} aria-hidden="true" />
      ) : glyph === 'closed' ? (
        <CircleSlash className={cn(statusToneTextClass(tone), icon)} aria-hidden="true" />
      ) : (
        <span
          className={cn(
            'block rounded-full',
            inner,
            faded ? FADED_BG[tone] : statusToneBgClass(tone)
          )}
        />
      )}
    </span>
  )
})

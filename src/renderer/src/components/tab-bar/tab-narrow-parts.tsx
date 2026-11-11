import type React from 'react'
import { Pin } from 'lucide-react'
import { TAB_NARROW_HIDDEN_CLASSES, TAB_NARROW_ICON_CLASSES } from './tab-width-rules'

/** A tab's leading icon; under a 120 px tab bar it gives way to the close on hover or focus (ORCA-717). */
export function TabLeadingIconSlot({
  swapsForClose,
  children
}: {
  swapsForClose: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <span
      data-tab-leading-icon="true"
      className={swapsForClose ? TAB_NARROW_ICON_CLASSES : 'contents'}
    >
      {children}
    </span>
  )
}

export function TabPinMark(): React.JSX.Element {
  return (
    <Pin
      className={`mr-1 size-3 shrink-0 text-muted-foreground ${TAB_NARROW_HIDDEN_CLASSES}`}
      aria-hidden
    />
  )
}

export function TabColorDot({ color }: { color: string }): React.JSX.Element {
  return (
    <span
      className={`mr-1.5 size-2 rounded-full shrink-0 ${TAB_NARROW_HIDDEN_CLASSES}`}
      style={{ backgroundColor: color }}
    />
  )
}

import React, { useRef } from 'react'
import { translate } from '@/i18n/i18n'

type Props = {
  height: number
  min: number
  max: number
  /** One floor's height: the arrow keys' step. */
  step: number
  /** null resets to the default height. */
  onResize: (height: number | null) => void
}

/** The building's bottom edge: drag, arrow keys or Home/End resize it; a double click resets. */
export function TeamBuildingResizeHandle({
  height,
  min,
  max,
  step,
  onResize
}: Props): React.JSX.Element {
  const drag = useRef<{ y: number; height: number } | null>(null)
  const clamp = (value: number): number => Math.min(max, Math.max(min, value))
  const onKeyDown = (event: React.KeyboardEvent): void => {
    const keys: Record<string, number> = { ArrowDown: height + step, ArrowUp: height - step }
    const next = { ...keys, Home: min, End: max }[event.key]
    if (next !== undefined) {
      onResize(clamp(next))
      event.preventDefault()
    }
  }
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={translate('teamPanel.building.resize', 'Resize building')}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(height)}
      tabIndex={0}
      data-team-building-resize=""
      onKeyDown={onKeyDown}
      onDoubleClick={() => onResize(null)}
      onPointerDown={(event) => {
        drag.current = { y: event.clientY, height }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (drag.current) {
          onResize(clamp(drag.current.height + event.clientY - drag.current.y))
        }
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      className="group flex h-2 cursor-row-resize touch-none items-center justify-center border-t border-border outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="h-0.5 w-8 rounded-full bg-muted-foreground/50 group-hover:bg-muted-foreground" />
    </div>
  )
}

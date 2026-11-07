import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  STRIP_INSET_PX,
  tabStripOverflowOf,
  tabStripScrollLeftFor,
  type TabStripOverflow
} from './team-panel-tab-strip'

// Why a fade: a narrow panel cannot fit every tab, and a clean cut hides that more exist.
function stripFade({ start, end }: TabStripOverflow): string | undefined {
  if (!start && !end) {
    return undefined
  }
  const left = start ? `transparent, black ${STRIP_INSET_PX}px` : 'black'
  const right = end ? `black calc(100% - ${STRIP_INSET_PX}px), transparent` : 'black'
  return `linear-gradient(to right, ${left}, ${right})`
}

export type TabStripCue = {
  /** Goes on the selected trigger; its parent is the scrolling strip. */
  activeTrigger: RefObject<HTMLButtonElement | null>
  overflow: TabStripOverflow
  stripProps: {
    'data-overflow-start': boolean
    'data-overflow-end': boolean
    style: CSSProperties
  }
}

/** Keeps the selected tab scrolled into view and says which edges hide tabs. */
export function useTabStripCue(activeId: string | undefined, tabIds: string): TabStripCue {
  const activeTrigger = useRef<HTMLButtonElement>(null)
  const [overflow, setOverflow] = useState<TabStripOverflow>({ start: false, end: false })
  // Why: a narrower window clips the selected tab too, so reveal on resize as well as on select.
  // Not scrollIntoView, which would also move the shell's hidden-overflow ancestors.
  useEffect(() => {
    const strip = activeTrigger.current?.parentElement
    if (!strip) {
      return
    }
    const reveal = (): void => {
      const trigger = activeTrigger.current
      if (trigger) {
        strip.scrollLeft = tabStripScrollLeftFor(
          strip.getBoundingClientRect(),
          trigger.getBoundingClientRect(),
          strip.scrollLeft
        )
      }
    }
    const measure = (): void => {
      const next = tabStripOverflowOf(strip)
      setOverflow((now) => (now.start === next.start && now.end === next.end ? now : next))
    }
    const update = (): void => {
      reveal()
      measure()
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(strip)
    strip.addEventListener('scroll', measure, { passive: true })
    return () => {
      observer.disconnect()
      strip.removeEventListener('scroll', measure)
    }
    // Why tabIds: a toggle that hides a tab changes what overflows without resizing the strip.
  }, [activeId, tabIds])
  const fade = stripFade(overflow)
  return {
    activeTrigger,
    overflow,
    stripProps: {
      'data-overflow-start': overflow.start,
      'data-overflow-end': overflow.end,
      style: { maskImage: fade, WebkitMaskImage: fade }
    }
  }
}

const CHEVRON =
  'pointer-events-none absolute top-0 bottom-px flex w-3.5 items-center justify-center bg-sidebar text-muted-foreground'

/** Why: a fade alone also hides the sliver of a cut tab; an opaque chevron says more lie that way. */
export function TabStripEdgeCues({ overflow }: { overflow: TabStripOverflow }): React.JSX.Element {
  return (
    <>
      {overflow.start ? (
        <span aria-hidden="true" className={`${CHEVRON} left-0`}>
          <ChevronLeft className="size-3.5" />
        </span>
      ) : null}
      {overflow.end ? (
        <span aria-hidden="true" className={`${CHEVRON} right-0`}>
          <ChevronRight className="size-3.5" />
        </span>
      ) : null}
    </>
  )
}

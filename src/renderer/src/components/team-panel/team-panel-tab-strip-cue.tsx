import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  STRIP_INSET_PX,
  tabStripFitFor,
  tabStripOverflowOf,
  tabStripScrollLeftFor,
  type TabStripFit,
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
  /** 0 draws the full labels; each level up is shorter, up to the caller's last level. */
  fit: number
  stripProps: {
    'data-overflow-start': boolean
    'data-overflow-end': boolean
    'data-fit': number
    style: CSSProperties
  }
}

/** Keeps the selected tab scrolled into view, says which edges hide tabs, and shortens labels to fit. */
export function useTabStripCue(
  activeId: string | undefined,
  shown: string,
  lastFitLevel = 0
): TabStripCue {
  const activeTrigger = useRef<HTMLButtonElement>(null)
  const [overflow, setOverflow] = useState<TabStripOverflow>({ start: false, end: false })
  const [fit, setFit] = useState<TabStripFit & { shown: string }>({ level: 0, needs: [], shown })
  // Why: other labels or counts need other widths, so fitting starts again from the full labels.
  if (fit.shown !== shown) {
    setFit({ level: 0, needs: [], shown })
  }
  // Why a layout effect: a shorter level replaces the full labels before they are ever painted cut.
  // Not scrollIntoView, which would also move the shell's hidden-overflow ancestors.
  useLayoutEffect(() => {
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
      const next = tabStripFitFor(fit, strip, lastFitLevel)
      if (next !== fit) {
        setFit({ ...next, shown: fit.shown })
        return
      }
      reveal()
      measure()
    }
    update()
    // Why on resize too: a narrower window clips the selected tab, a wider one has room for longer labels.
    // The tabs too: their labels can grow with no change to the strip's own size.
    const observer = new ResizeObserver(update)
    observer.observe(strip)
    for (const tab of strip.children) {
      observer.observe(tab)
    }
    strip.addEventListener('scroll', measure, { passive: true })
    return () => {
      observer.disconnect()
      strip.removeEventListener('scroll', measure)
    }
    // Why shown: a toggle that hides a tab changes what overflows without resizing the strip.
  }, [activeId, shown, fit, lastFitLevel])
  const fade = stripFade(overflow)
  return {
    activeTrigger,
    overflow,
    fit: fit.shown === shown ? fit.level : 0,
    stripProps: {
      'data-overflow-start': overflow.start,
      'data-overflow-end': overflow.end,
      'data-fit': fit.shown === shown ? fit.level : 0,
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

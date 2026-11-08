import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react'
import { StatusDot } from '@/components/StatusDot'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { TeamPanelGameModel } from '../../../../shared/team-panel-model-types'
import { teamDisplayPagesOf } from './team-display-pages'
import { TeamDisplayPageView, teamDisplayPageTitle } from './team-display-page-view'
import { teamDisplayTickerOf } from './team-display-ticker'

/** V28's pace: 58 ticks of 120 ms a page, 30 a ticker line. */
export const TEAM_DISPLAY_PAGE_MS = 7_000
const TICKER_MS = 3_600

const reducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const navButton =
  'inline-flex h-[22px] w-[18px] items-center justify-center text-muted-foreground hover:text-foreground'

/** The Display look: metric pages that turn on their own, hold under the pointer or focus, and step by hand. */
export function TeamDisplayCarousel({ model }: { model: TeamPanelGameModel }): React.JSX.Element {
  const pages = useMemo(() => teamDisplayPagesOf(model), [model])
  // Why not memoized on the model: its words must follow a language switch with the same model.
  const ticker = teamDisplayTickerOf(model)
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [line, setLine] = useState(0)
  const go = (next: number): void => setIndex((next + pages.length) % pages.length)
  const held = paused || hovered || focused
  // Why keyed on the page: a manual step restarts the wait, as V28 does.
  useEffect(() => {
    if (held || reducedMotion()) {
      return
    }
    const timer = window.setTimeout(
      () => setIndex((one) => (one + 1) % pages.length),
      TEAM_DISPLAY_PAGE_MS
    )
    return () => window.clearTimeout(timer)
  }, [held, index, pages.length])
  useEffect(() => {
    if (ticker.length < 2 || reducedMotion()) {
      return
    }
    const timer = window.setInterval(() => setLine((one) => one + 1), TICKER_MS)
    return () => window.clearInterval(timer)
  }, [ticker.length])
  const page = pages[index]
  const message = ticker[line % ticker.length]
  return (
    <section
      aria-roledescription="carousel"
      aria-label={translate('teamPanel.display.label', 'Team metrics')}
      className="@container flex shrink-0 flex-col gap-3 border-b border-border bg-background p-3 font-mono"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocused(false)
        }
      }}
    >
      <div className="-mt-1 flex h-[22px] items-center justify-between">
        <span data-team-display-title="" className="text-xs font-medium text-foreground">
          {teamDisplayPageTitle(page.id)}
        </span>
        <span className="flex items-center">
          <button
            type="button"
            className={navButton}
            aria-pressed={paused}
            aria-label={
              paused
                ? translate('teamPanel.display.resume', 'Resume the carousel')
                : translate('teamPanel.display.pause', 'Pause the carousel')
            }
            onClick={() => setPaused((one) => !one)}
          >
            {paused ? <Play className="size-3" /> : <Pause className="size-3" />}
          </button>
          <button
            type="button"
            className={navButton}
            aria-label={translate('teamPanel.display.previous', 'Previous metric')}
            onClick={() => go(index - 1)}
          >
            <ChevronLeft className="size-3" />
          </button>
          {pages.map((one, at) => (
            <button
              key={one.id}
              type="button"
              className="group inline-flex h-[22px] w-3 items-center justify-center"
              aria-label={teamDisplayPageTitle(one.id)}
              aria-current={at === index}
              onClick={() => go(at)}
            >
              <i
                className={cn(
                  'size-[5px] rounded-full',
                  at === index
                    ? 'bg-foreground'
                    : 'bg-muted-foreground/40 group-hover:bg-muted-foreground'
                )}
              />
            </button>
          ))}
          <button
            type="button"
            className={navButton}
            aria-label={translate('teamPanel.display.next', 'Next metric')}
            onClick={() => go(index + 1)}
          >
            <ChevronRight className="size-3" />
          </button>
        </span>
      </div>
      <div
        key={page.id}
        data-team-display-stage=""
        className="h-[122px] overflow-hidden motion-safe:animate-in motion-safe:fade-in"
      >
        <TeamDisplayPageView page={page} />
      </div>
      <div
        className={cn(
          'flex min-h-[27px] items-center gap-2 border-t border-border pt-2 font-sans text-xs text-foreground',
          message.alert && 'text-status-attention'
        )}
      >
        <StatusDot
          tone={message.alert ? 'attention' : 'success'}
          glyph={message.alert ? 'question' : 'dot'}
        />
        <span data-team-display-ticker="" className="min-w-0 truncate">
          {message.text}
        </span>
      </div>
    </section>
  )
}

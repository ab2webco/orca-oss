import React from 'react'
import { cn } from '@/lib/utils'
import CacheTimer from './CacheTimer'
import type { SidebarSoloHover, SidebarSoloHoverOpen } from './sidebar-solo-hover'

/** V30's hoverHtml for a solo row, laid out like the member and lead cards. */
export function SidebarSoloHoverDetails({
  hover,
  cacheTtlMs,
  onOpen
}: {
  hover: SidebarSoloHover
  cacheTtlMs: number
  /** Opens the line's PR or ticket in Orca; a line with no handler stays text. */
  onOpen?: Partial<Record<SidebarSoloHoverOpen, (event: React.MouseEvent) => void>>
}): React.JSX.Element {
  // Why: a timer with no length counts nothing down, so its line would only read 0:00.
  const lines = hover.lines.filter((line) => line.kind !== 'cache' || cacheTtlMs > 0)
  return (
    <div data-sidebar-solo-hover="" className="min-w-0">
      <h5 data-solo-hover-title="" className="m-0 text-[13px] font-semibold text-foreground">
        {hover.title}
      </h5>
      {hover.subtitle ? (
        <p data-solo-hover-subtitle="" className="m-0 mt-0.5 text-muted-foreground">
          {hover.subtitle}
        </p>
      ) : null}
      <dl className="m-0 mt-2.5 grid grid-cols-[62px_minmax(0,1fr)] gap-x-2.5 gap-y-1">
        {lines.map((line) => (
          <React.Fragment key={line.label}>
            <dt className="text-muted-foreground">{line.label}</dt>
            {line.kind === 'cache' ? (
              <dd className="m-0">
                <CacheTimer startedAt={line.expiresAt - cacheTtlMs} ttlMs={cacheTtlMs} />
              </dd>
            ) : (
              <dd
                data-asks={line.asks ? '' : undefined}
                className={cn(
                  'm-0 [overflow-wrap:anywhere]',
                  line.asks && 'text-agent-question-text'
                )}
              >
                {line.opens && onOpen?.[line.opens] ? (
                  <button
                    type="button"
                    className="text-left hover:underline"
                    onClick={onOpen[line.opens]}
                  >
                    {line.value}
                  </button>
                ) : (
                  line.value
                )}
              </dd>
            )}
          </React.Fragment>
        ))}
      </dl>
    </div>
  )
}

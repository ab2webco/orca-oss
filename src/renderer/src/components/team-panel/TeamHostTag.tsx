import { useLayoutEffect, useRef, useState } from 'react'
import { Monitor, Server } from 'lucide-react'
import type { TeamHost } from '../../../../shared/team-panel-model-types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useTeamHostName } from './TeamHostName'

/** A card's host: the whole name, or its machine's icon when the name would be cut (ORCA-1149). */
export function TeamHostTag({ host }: { host: TeamHost }): React.JSX.Element {
  const name = useTeamHostName(host)
  const tagRef = useRef<HTMLSpanElement>(null)
  const nameRef = useRef<HTMLSpanElement>(null)
  const [fits, setFits] = useState(true)

  useLayoutEffect(() => {
    const tag = tagRef.current
    const text = nameRef.current
    if (!tag || !text) {
      return
    }
    // Why the name's own width: the tag's room is set by the row (flex-1, basis-0), not by it.
    const measure = (): void => setFits(text.scrollWidth <= tag.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(measure)
    observer.observe(tag)
    return () => observer.disconnect()
  }, [name])

  const Icon = host.kind === 'local' ? Monitor : Server
  return (
    <span
      ref={tagRef}
      data-team-host=""
      className="relative flex min-w-0 flex-1 basis-0 justify-end overflow-hidden font-mono text-[11px] text-muted-foreground"
    >
      <span
        ref={nameRef}
        data-team-host-name=""
        aria-hidden={fits ? undefined : true}
        className={cn('whitespace-nowrap', !fits && 'invisible absolute right-0')}
      >
        {name}
      </span>
      {fits ? null : (
        <Tooltip>
          <TooltipTrigger asChild>
            <Icon
              data-team-host-icon={host.kind}
              role="img"
              aria-label={name}
              className="size-3.5 shrink-0"
            />
          </TooltipTrigger>
          <TooltipContent>{name}</TooltipContent>
        </Tooltip>
      )}
    </span>
  )
}

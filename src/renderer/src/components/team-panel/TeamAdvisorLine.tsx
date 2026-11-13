import { useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Jev's sentence on the advisor card: two lines, then an ellipsis. The whole sentence is the hover
 * title, and a tap opens it, for touch where there is no hover (ORCA-1173).
 */
export function TeamAdvisorLine({ line }: { line: string }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <button
      type="button"
      data-team-advisor-line=""
      title={line}
      aria-expanded={open}
      onClick={() => setOpen((was) => !was)}
      className={cn(
        'whitespace-normal break-words text-left text-xs text-muted-foreground',
        !open && 'line-clamp-2'
      )}
    >
      {line}
    </button>
  )
}

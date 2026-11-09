import React from 'react'
import { ChevronDown, Workflow } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'

/** The show/hide control for a card's child workspaces. */
export function WorktreeLineageChildChip({
  newCardStyle,
  collapsed,
  ariaLabel,
  shortLabel,
  onToggle
}: {
  newCardStyle: boolean
  collapsed: boolean | undefined
  ariaLabel: string
  shortLabel: string
  onToggle: ((event: React.MouseEvent<HTMLButtonElement>) => void) | undefined
}): React.JSX.Element {
  return (
    <div
      className={cn('relative mt-1 flex min-w-0 justify-start', !newCardStyle && '-ml-1')}
      style={{
        color: 'color-mix(in srgb, var(--muted-foreground) 42%, var(--worktree-sidebar))'
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="relative z-10 h-[18px] max-w-[8rem] gap-1 rounded-md border border-worktree-sidebar-border bg-worktree-sidebar px-1.5 text-[10px] font-medium leading-none text-muted-foreground shadow-none hover:bg-worktree-sidebar-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-worktree-sidebar-ring"
            aria-label={ariaLabel}
            aria-expanded={!collapsed}
            onClick={onToggle}
          >
            <Workflow className="size-2.5" />
            <span className="truncate">{shortLabel}</span>
            <ChevronDown
              className={cn('size-2.5 transition-transform', collapsed && '-rotate-90')}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          {collapsed
            ? translate('auto.components.sidebar.WorktreeCard.8cb634cda6', 'Show child workspaces')
            : translate('auto.components.sidebar.WorktreeCard.57eaa61b55', 'Hide child workspaces')}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

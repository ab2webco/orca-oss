import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/** Task-tracker badge that names the linked item instead of relying on a bare
 *  provider glyph. Shrinks and ellipsizes so a narrow card truncates the
 *  identifier rather than pushing the chip outside the card. */
export function MetaIdentifierChip({
  provider,
  label,
  identifier,
  icon
}: {
  provider: string
  label: string
  identifier: string
  icon: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className="h-[16px] min-w-0 max-w-[7rem] shrink gap-1 rounded border-border/60 bg-transparent px-1.5 text-[10px] font-medium leading-none text-muted-foreground"
          aria-label={label}
          data-worktree-card-identifier-chip={provider}
        >
          {icon}
          <span className="truncate">{identifier}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function MetaIconBadge({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <span className="inline-flex size-3.5 shrink-0 items-center justify-center text-muted-foreground/70 hover:text-foreground [&>svg]:size-3.5">
      {children}
      <span className="sr-only">{label}</span>
    </span>
  )
}

export function DetailHeader({
  icon,
  label,
  actions
}: {
  icon: React.ReactNode
  label: string
  actions?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-0.5">{actions}</div> : null}
    </div>
  )
}

export function MetadataActionIcon({
  label,
  href,
  onClick,
  children
}: {
  label: string
  href?: string
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void
  children: React.ReactNode
}): React.JSX.Element {
  const trigger = href ? (
    <Button asChild variant="ghost" size="icon-xs" className="size-6">
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        aria-label={label}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </a>
    </Button>
  ) : (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="size-6"
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation()
        onClick?.(event)
      }}
    >
      {children}
    </Button>
  )

  return (
    <Tooltip>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

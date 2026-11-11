import React from 'react'
import { AlertTriangle, ChevronDown, Loader2, ServerOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { HostHeaderRow } from '../../host-section-rows'
import { HostSectionHeaderMenu } from '../../HostSectionHeaderMenu'
import { useHostActiveAgentCount } from '../../host-header-active-count'
import { SidebarTreeGlyph } from '../../sidebar-tree-glyphs'

function HostActiveCount({ worktreeIds }: { worktreeIds: readonly string[] }): React.JSX.Element {
  const active = useHostActiveAgentCount(worktreeIds)
  return (
    <span
      data-host-header-active=""
      className="ml-auto shrink-0 text-[11px] font-normal leading-none tabular-nums text-muted-foreground/70 transition-opacity can-hover:group-hover/host-header:opacity-0 group-focus-within/host-header:opacity-0"
    >
      {translate('auto.components.sidebar.WorktreeList.hostActiveAgents', '{{count}} active', {
        count: active
      })}
    </span>
  )
}

function HostHeaderHealthIcon({
  health
}: {
  health: HostHeaderRow['health']
}): React.JSX.Element | null {
  // Why: only surface states needing attention; healthy is the silent default.
  if (health === 'connecting') {
    return <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
  }
  if (health === 'blocked' || health === 'error') {
    return <AlertTriangle className="size-3 shrink-0 text-destructive" />
  }
  return null
}

function getHostHeaderDetail(row: HostHeaderRow): { text: string; isWarning: boolean } | null {
  // Why: a blocked compatibility verdict earns a compact warning so the host stands out.
  if (row.health === 'blocked') {
    return {
      text: translate('auto.components.sidebar.WorktreeList.7a8b9c0d1e', 'Update required'),
      isWarning: true
    }
  }
  // Why: auth-failed needs a worded status; the health icon alone doesn't tell the user to re-auth.
  if (row.connectionStatus === 'auth-failed') {
    return {
      text: translate(
        'auto.components.sidebar.WorktreeList.hostAuthNeeded',
        'Authentication needed'
      ),
      isWarning: true
    }
  }
  if (row.health === 'disconnected') {
    return {
      text: translate('auto.components.sidebar.WorktreeList.hostDisconnected', 'Disconnected'),
      isWarning: false
    }
  }
  // Why: V30 names a healthy host and its active count only; the transport sits in the menu.
  return null
}

export function HostSectionHeader({
  row,
  onToggle,
  onDragPointerDown,
  dragging
}: {
  row: HostHeaderRow
  onToggle: () => void
  onDragPointerDown?: (event: React.PointerEvent<HTMLElement>) => void
  dragging?: boolean
}): React.JSX.Element {
  const isBlocked = row.health === 'blocked'
  const isDisconnected = row.health === 'disconnected'
  const detail = getHostHeaderDetail(row)
  return (
    <div className="px-2 pt-1">
      {/* Why: V30 draws a host as a plain tree row: dim server glyph, name, active count on the right. */}
      <div
        role="button"
        tabIndex={0}
        data-host-header-drag-id={row.hostId}
        aria-expanded={!row.collapsed}
        className={cn(
          'group/host-header relative flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-worktree-sidebar-accent/50',
          onDragPointerDown && 'cursor-grab active:cursor-grabbing',
          isBlocked && 'text-destructive',
          dragging && 'pointer-events-none opacity-0'
        )}
        onPointerDown={onDragPointerDown}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle()
          }
        }}
      >
        {isDisconnected ? (
          <ServerOff className="size-3.5 shrink-0 text-muted-foreground/60" strokeWidth={1.75} />
        ) : (
          <SidebarTreeGlyph name="server" />
        )}
        <HostHeaderHealthIcon health={row.health} />
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span
            className={cn(
              'min-w-0 truncate text-[12.5px] font-medium leading-none',
              isDisconnected ? 'text-muted-foreground' : 'text-foreground'
            )}
          >
            {row.label}
          </span>
          {detail ? (
            <span
              className={cn(
                'shrink-0 truncate text-[11px] leading-none',
                detail.isWarning ? 'text-destructive' : 'text-muted-foreground/70'
              )}
            >
              {detail.text}
            </span>
          ) : (
            <HostActiveCount worktreeIds={row.worktreeIds} />
          )}
        </div>
        {/* Why an overlay: V30's count sits flush right; the hover controls must not reserve space. */}
        <div
          data-host-header-controls=""
          className="absolute inset-y-0 right-1 flex items-center gap-1 can-hover:opacity-0 transition-opacity group-hover/host-header:opacity-100 group-focus-within/host-header:opacity-100 has-[[data-state=open]]:opacity-100"
        >
          <div className="flex size-4 shrink-0 items-center justify-center text-muted-foreground/60">
            <ChevronDown
              className={cn('size-3.5 transition-transform', row.collapsed && '-rotate-90')}
            />
          </div>
          <span data-host-header-action="">
            <HostSectionHeaderMenu row={row} />
          </span>
        </div>
      </div>
    </div>
  )
}

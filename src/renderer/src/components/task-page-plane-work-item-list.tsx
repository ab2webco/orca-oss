import React, { useMemo, useState } from 'react'
import { ArrowRight, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { getPlanePriorityLabel } from './plane-work-item-sorter'
import type { PlaneWorkItem } from '../../../shared/plane-types'

export type TaskPagePlaneWorkItemSection = {
  key: string
  label: string
  items: PlaneWorkItem[]
}

// Why: Plane states carry a native `sequence` on the work item itself, unlike
// Jira (which needs a separate board-order RPC), so grouping needs no fetch.
export function groupPlaneWorkItemsByState(
  items: readonly PlaneWorkItem[],
  direction: 'asc' | 'desc' = 'asc'
): TaskPagePlaneWorkItemSection[] {
  const sections = new Map<
    string,
    { key: string; label: string; items: PlaneWorkItem[]; rank: number }
  >()
  for (const item of items) {
    const key = `state:${item.state.id}`
    const existing = sections.get(key)
    const rank = item.state.sequence ?? Number.POSITIVE_INFINITY
    if (existing) {
      existing.items.push(item)
      existing.rank = Math.min(existing.rank, rank)
    } else {
      sections.set(key, { key, label: item.state.name, items: [item], rank })
    }
  }

  const sorted = [...sections.values()].sort((a, b) =>
    a.rank === b.rank ? a.label.localeCompare(b.label) : a.rank - b.rank
  )
  const result = sorted.map(({ key, label, items: sectionItems }) => ({
    key,
    label,
    items: sectionItems
  }))
  return direction === 'desc' ? result.toReversed() : result
}

function isSelectedItem(item: PlaneWorkItem, selectedItem: PlaneWorkItem | null): boolean {
  if (!selectedItem || item.identifier !== selectedItem.identifier) {
    return false
  }
  return (
    !selectedItem.workspaceId || !item.workspaceId || selectedItem.workspaceId === item.workspaceId
  )
}

type PlaneWorkItemRowProps = {
  formatUpdatedAt: (updatedAt: string) => string
  getStateTone: (stateGroup: string) => string
  item: PlaneWorkItem
  onOpenItem: (item: PlaneWorkItem) => void
  onStartWorkspace: (item: PlaneWorkItem) => void
  selected: boolean
  showWorkspaceContext: boolean
}

function PlaneWorkItemRow({
  formatUpdatedAt,
  getStateTone,
  item,
  onOpenItem,
  onStartWorkspace,
  selected,
  showWorkspaceContext
}: PlaneWorkItemRowProps): React.JSX.Element {
  const labels = item.labels.slice(0, 3)
  const contextLabel =
    showWorkspaceContext && item.workspaceSlug
      ? `${item.workspaceSlug} / ${item.project.identifier}`
      : item.project.identifier
  const primaryAssignee = item.assignees?.[0]
  const extraAssigneeCount = (item.assignees?.length ?? 0) - 1
  const priorityLabel = getPlanePriorityLabel(item.priority)

  return (
    // Why: the row contains action buttons, so a native button wrapper would
    // create invalid nested buttons; role + keyboard handling preserves access.
    <div
      role="button"
      tabIndex={0}
      aria-current={selected ? 'true' : undefined}
      data-current={selected ? 'true' : undefined}
      onClick={() => onOpenItem(item)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) {
          return
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpenItem(item)
        }
      }}
      className={cn(
        'group/row grid min-h-12 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-left transition hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:grid-cols-[90px_minmax(0,1fr)_128px_92px_80px_64px] lg:grid-cols-[96px_minmax(0,1.25fr)_132px_120px_136px_96px_64px] xl:grid-cols-[104px_minmax(0,1.45fr)_144px_132px_160px_128px_72px]',
        selected && 'bg-accent'
      )}
    >
      <span className="block truncate font-mono text-[12px] text-muted-foreground max-md:!hidden">
        {item.identifier}
      </span>

      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground md:hidden">
            {item.identifier}
          </span>
          <h3 className="min-w-0 truncate text-[13px] font-medium text-foreground">{item.title}</h3>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-1.5 md:!hidden">
          <span
            className={cn(
              'inline-flex min-w-0 items-center rounded-full border px-1.5 py-0.5 text-[11px] font-medium',
              getStateTone(item.state.group)
            )}
          >
            <span className="truncate">{item.state.name}</span>
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground">{priorityLabel}</span>
          <span className="min-w-0 truncate text-[11px] text-muted-foreground">
            {primaryAssignee?.displayName ??
              translate('auto.components.TaskPage.42a9160321', 'Unassigned')}
          </span>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-1 max-lg:!hidden">
          <span className="max-w-[160px] truncate text-[10px] text-muted-foreground xl:!hidden">
            {contextLabel}
          </span>
          {labels.map((label) => (
            <span
              key={label}
              className="max-w-[140px] truncate rounded-full border border-border/50 bg-muted/35 px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              {label}
            </span>
          ))}
          {item.labels.length > labels.length ? (
            <span className="text-[10px] text-muted-foreground">
              +{item.labels.length - labels.length}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex min-w-0 max-md:!hidden">
        <span
          className={cn(
            'inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
            getStateTone(item.state.group)
          )}
        >
          <span className="truncate">{item.state.name}</span>
        </span>
      </div>

      <span className="block truncate text-[12px] text-muted-foreground max-md:!hidden">
        {priorityLabel}
      </span>

      <div className="flex min-w-0 items-center gap-2 text-[12px] text-muted-foreground max-lg:!hidden">
        {primaryAssignee?.avatarUrl ? (
          <img
            src={primaryAssignee.avatarUrl}
            alt={primaryAssignee.displayName}
            className="size-5 shrink-0 rounded-full"
          />
        ) : (
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border/50 bg-muted/40 text-[10px]">
            {primaryAssignee?.displayName?.slice(0, 1) ?? '-'}
          </span>
        )}
        <span className="truncate">
          {primaryAssignee?.displayName ??
            translate('auto.components.TaskPage.42a9160321', 'Unassigned')}
        </span>
        {extraAssigneeCount > 0 ? (
          <span className="shrink-0 text-[11px]">+{extraAssigneeCount}</span>
        ) : null}
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <div className="block min-w-0 truncate text-[12px] text-muted-foreground max-md:!hidden">
            {formatUpdatedAt(item.updatedAt)}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {new Date(item.updatedAt).toLocaleString()}
        </TooltipContent>
      </Tooltip>

      <div className="flex shrink-0 items-center justify-end gap-1 md:opacity-0 md:transition-opacity md:group-hover/row:opacity-100 md:group-focus-within/row:opacity-100">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={(event) => {
                event.stopPropagation()
                onStartWorkspace(item)
              }}
              aria-label={translate(
                'auto.components.TaskPage.planeStartWorkspaceFrom',
                'Start workspace from {{value0}}',
                { value0: item.identifier }
              )}
            >
              <ArrowRight className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            {translate('auto.components.TaskPage.9497f2787c', 'Start workspace')}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={(event) => {
                event.stopPropagation()
                window.api.shell.openUrl(item.url)
              }}
              aria-label={translate(
                'auto.components.TaskPage.planeOpenInPlane',
                'Open {{value0}} in Plane',
                { value0: item.identifier }
              )}
            >
              <ExternalLink className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            {translate('auto.components.TaskPage.planeOpenInPlaneShort', 'Open in Plane')}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

type TaskPagePlaneWorkItemListProps = {
  formatUpdatedAt: (updatedAt: string) => string
  getStateTone: (stateGroup: string) => string
  items: PlaneWorkItem[]
  onOpenItem: (item: PlaneWorkItem) => void
  onStartWorkspace: (item: PlaneWorkItem) => void
  selectedItem: PlaneWorkItem | null
  showWorkspaceContext: boolean
  statusDirection?: 'asc' | 'desc'
}

export function TaskPagePlaneWorkItemList({
  formatUpdatedAt,
  getStateTone,
  items,
  onOpenItem,
  onStartWorkspace,
  selectedItem,
  showWorkspaceContext,
  statusDirection = 'asc'
}: TaskPagePlaneWorkItemListProps): React.JSX.Element {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())
  const sections = useMemo(
    () => groupPlaneWorkItemsByState(items, statusDirection),
    [items, statusDirection]
  )

  return (
    <div className="divide-y divide-border/50">
      {sections.map((section) => {
        const open = !collapsedGroups.has(section.key)
        return (
          <Collapsible
            key={section.key}
            open={open}
            onOpenChange={(nextOpen) => {
              setCollapsedGroups((current) => {
                const next = new Set(current)
                if (nextOpen) {
                  next.delete(section.key)
                } else {
                  next.add(section.key)
                }
                return next
              })
            }}
          >
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="h-9 w-full justify-start rounded-none bg-muted/35 px-3 text-left font-normal transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
              >
                {open ? (
                  <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 truncate text-[13px] font-medium text-foreground">
                  {section.label}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {section.items.length}
                </span>
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="divide-y divide-border/50 border-t border-border/50">
              {section.items.map((item) => (
                <PlaneWorkItemRow
                  key={`${item.workspaceId ?? 'workspace'}:${item.id || item.identifier}`}
                  formatUpdatedAt={formatUpdatedAt}
                  getStateTone={getStateTone}
                  item={item}
                  onOpenItem={onOpenItem}
                  onStartWorkspace={onStartWorkspace}
                  selected={isSelectedItem(item, selectedItem)}
                  showWorkspaceContext={showWorkspaceContext}
                />
              ))}
            </CollapsibleContent>
          </Collapsible>
        )
      })}
    </div>
  )
}

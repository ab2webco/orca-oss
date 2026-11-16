import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { rowKeyMatchesRenderRow } from './render-row-lookup'
import { revealMountedSidebarRowElement } from './mounted-row-reveal'
import { getSidebarRowRevealAncestorKeys } from './reveal-ancestors'
import { MAX_REVEAL_RETRIES, type PendingSidebarRevealArgs } from './pending-reveal-inputs'

// Drives the store's pending reveal of any sidebar row (a project header, a folder, a card)
// from "expand the ancestors" through "scroll the mounted element into view".
export function usePendingSidebarRowReveal(args: PendingSidebarRevealArgs): void {
  const [retryTick, setRetryTick] = useState(0)
  const retryRef = useRef<{ rowKey: string; count: number } | null>(null)
  const argsRef = useRef(args)
  useLayoutEffect(() => {
    argsRef.current = args
  })

  const {
    pendingRevealSidebarRow,
    clearPendingRevealSidebarRow,
    renderRows,
    virtualizer,
    schedulePendingRevealFrame,
    cancelPendingRevealFrames,
    flashRevealedRow,
    markRevealScroll
  } = args

  const scheduleRetryTick = useCallback(
    (cancelled: () => boolean) => {
      schedulePendingRevealFrame(() => {
        if (!cancelled()) {
          setRetryTick((tick) => tick + 1)
        }
      })
    },
    [schedulePendingRevealFrame]
  )

  useEffect(() => {
    if (!pendingRevealSidebarRow) {
      return
    }
    const current = argsRef.current

    const isProjectHeaderTarget =
      pendingRevealSidebarRow.rowKey.startsWith('project-group:') ||
      pendingRevealSidebarRow.rowKey.startsWith('project:') ||
      pendingRevealSidebarRow.rowKey.startsWith('repo:')
    if (isProjectHeaderTarget && current.groupBy !== 'repo') {
      return
    }

    let toggledAncestor = false
    for (const groupKey of getSidebarRowRevealAncestorKeys({
      rowKey: pendingRevealSidebarRow.rowKey,
      repoMap: current.repoMap,
      projectGroups: current.projectGroups,
      projectGrouping: current.projectGrouping
    })) {
      if (current.collapsedGroups.has(groupKey)) {
        current.toggleGroup(groupKey)
        toggledAncestor = true
      }
    }
    if (toggledAncestor) {
      return
    }

    let cancelled = false
    const retryPendingReveal = (): boolean => {
      const previousRetry = retryRef.current
      const nextRetryCount =
        previousRetry?.rowKey === pendingRevealSidebarRow.rowKey ? previousRetry.count + 1 : 1
      retryRef.current = {
        rowKey: pendingRevealSidebarRow.rowKey,
        count: nextRetryCount
      }
      if (nextRetryCount <= MAX_REVEAL_RETRIES) {
        scheduleRetryTick(() => cancelled)
        return true
      }
      return false
    }
    schedulePendingRevealFrame(() => {
      if (cancelled) {
        return
      }
      const targetIndex = renderRows.findIndex((row) =>
        rowKeyMatchesRenderRow(row, pendingRevealSidebarRow.rowKey)
      )
      if (targetIndex === -1) {
        if (retryPendingReveal()) {
          return
        }
        retryRef.current = null
        clearPendingRevealSidebarRow()
        toast.error(
          translate(
            'auto.components.sidebar.WorktreeList.sidebarRowMissing',
            'Target no longer exists'
          )
        )
        return
      }

      const container = argsRef.current.scrollRef.current
      const revealedElement = container
        ? revealMountedSidebarRowElement(
            container,
            pendingRevealSidebarRow.rowKey,
            pendingRevealSidebarRow.behavior,
            markRevealScroll
          )
        : null
      if (revealedElement) {
        if (pendingRevealSidebarRow.highlight) {
          flashRevealedRow(pendingRevealSidebarRow.rowKey)
        }
        retryRef.current = null
        clearPendingRevealSidebarRow()
        return
      }

      virtualizer.scrollToIndex(targetIndex, { align: 'auto', behavior: 'auto' })
      if (retryPendingReveal()) {
        return
      }
      retryRef.current = null
      clearPendingRevealSidebarRow()
    })

    return () => {
      cancelled = true
      cancelPendingRevealFrames()
    }
  }, [
    pendingRevealSidebarRow,
    args.repoMap,
    args.projectGroups,
    args.projectGrouping,
    args.collapsedGroups,
    args.groupBy,
    args.toggleGroup,
    renderRows,
    virtualizer,
    retryTick,
    flashRevealedRow,
    markRevealScroll,
    clearPendingRevealSidebarRow,
    schedulePendingRevealFrame,
    cancelPendingRevealFrames,
    scheduleRetryTick
  ])
}

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { VIRTUALIZED_SCROLL_ANCHOR_RECORD_EVENT } from '@/hooks/useVirtualizedScrollAnchor'
import type { PendingSidebarWorktreeReveal } from '@/store/slices/ui'
import { getRenderRowOptionId } from './active-descendant-option'
import { findPreferredRenderRowIndexForWorktree, getRenderRowSidebarKey } from './render-row-lookup'
import {
  isMountedWorktreeElementRevealed,
  revealMountedWorktreeElement
} from './mounted-row-reveal'
import { sidebarWorkspaceStillExists } from './folder-reveal'
import {
  expandGroupsForWorktreeReveal,
  MAX_REVEAL_RETRIES,
  resolvePendingSidebarReveal,
  type PendingSidebarRevealArgs
} from './pending-reveal-inputs'
import {
  REVEAL_HOLD_MAX_MS,
  startRevealHold,
  stepRevealHold,
  type RevealHold,
  type RevealHoldLayout
} from './reveal-hold'
import { usePendingSidebarRowReveal } from './use-pending-row-reveal'

/** One worktree reveal request, kept across effect re-runs until it settles or runs out of time. */
type WorktreeRevealProgress = {
  reveal: PendingSidebarWorktreeReveal
  startedAt: number
  stagings: number
  hold: RevealHold | null
  /** The folds the row landed under; any other set means the person folded or unfolded since. */
  landedGroups: Set<string> | null
  announced: boolean
}

// Why: the list's scroll event, which re-records the anchor, waits for a frame; a restore
// that runs first would put back the row that was on top before the reveal.
function recordScrollAnchorHere(container: HTMLElement | null): void {
  container?.dispatchEvent(new Event(VIRTUALIZED_SCROLL_ANCHOR_RECORD_EVENT))
}

function readRevealLayout(container: HTMLElement): RevealHoldLayout {
  return {
    clientHeight: container.clientHeight,
    scrollHeight: container.scrollHeight,
    width: container.getBoundingClientRect().width
  }
}

// Drives the store's two pending reveal requests (a worktree card, or any sidebar row)
// from "expand the ancestors" through "scroll the mounted element into view".
export function usePendingSidebarReveal(args: PendingSidebarRevealArgs): void {
  const setRenamingWorktreeId = useAppStore((s) => s.setRenamingWorktreeId)
  const [pendingRevealRetryTick, setPendingRevealRetryTick] = useState(0)
  const pendingRevealRetryRef = useRef<{ worktreeId: string; count: number } | null>(null)
  const progressRef = useRef<WorktreeRevealProgress | null>(null)
  const argsRef = useRef(args)
  useLayoutEffect(() => {
    argsRef.current = args
  })

  const {
    pendingRevealWorktree,
    clearPendingRevealWorktreeId,
    renderRows,
    virtualizer,
    schedulePendingRevealFrame,
    cancelPendingRevealFrames,
    flashRevealedRow,
    markRevealScroll,
    pinnedDisplayPolicy
  } = args

  const scheduleRetryTick = useCallback(
    (cancelled: () => boolean) => {
      schedulePendingRevealFrame(() => {
        if (!cancelled()) {
          setPendingRevealRetryTick((tick) => tick + 1)
        }
      })
    },
    [schedulePendingRevealFrame]
  )

  useEffect(() => {
    if (!pendingRevealWorktree) {
      progressRef.current = null
      return
    }
    const current = argsRef.current
    if (progressRef.current?.reveal !== pendingRevealWorktree) {
      progressRef.current = {
        reveal: pendingRevealWorktree,
        startedAt: window.performance.now(),
        stagings: 0,
        hold: null,
        landedGroups: null,
        announced: false
      }
    }
    const progress = progressRef.current
    const finish = (): void => {
      pendingRevealRetryRef.current = null
      progressRef.current = null
      clearPendingRevealWorktreeId()
    }
    if (progress.landedGroups) {
      // Why: a fold after the row landed is the person's; unfolding it again would undo them.
      if (current.collapsedGroups !== progress.landedGroups) {
        finish()
        return
      }
    } else if (current.agentSendTargetWorktreeId !== pendingRevealWorktree.worktreeId) {
      expandGroupsForWorktreeReveal(current, pendingRevealWorktree.worktreeId)
    }

    let cancelled = false
    const retryPassiveReveal = (): boolean => {
      const previousRetry = pendingRevealRetryRef.current
      const nextRetryCount =
        previousRetry?.worktreeId === pendingRevealWorktree.worktreeId ? previousRetry.count + 1 : 1
      pendingRevealRetryRef.current = {
        worktreeId: pendingRevealWorktree.worktreeId,
        count: nextRetryCount
      }
      if (nextRetryCount <= MAX_REVEAL_RETRIES) {
        scheduleRetryTick(() => cancelled)
        return true
      }
      return false
    }
    // Why: a landed row can still be moved out by a resize, a theme change, a late card or the
    // scroll anchor; hold the request and reveal again until the row stays put.
    const holdLandedReveal = (container: HTMLElement, optionId: string | undefined): void => {
      progress.hold ??= startRevealHold(window.performance.now(), readRevealLayout(container))
      progress.landedGroups ??= argsRef.current.collapsedGroups
      const watch = (): void => {
        if (cancelled || !progress.hold) {
          return
        }
        const { hold, step } = stepRevealHold(progress.hold, {
          now: window.performance.now(),
          inView: isMountedWorktreeElementRevealed(
            container,
            pendingRevealWorktree.worktreeId,
            optionId
          ),
          layout: readRevealLayout(container),
          userScrolling: argsRef.current.hasDirectScrollInput()
        })
        progress.hold = hold
        if (step === 'wait') {
          schedulePendingRevealFrame(watch)
        } else if (step === 'reassert') {
          scheduleRetryTick(() => cancelled)
        } else {
          finish()
        }
      }
      schedulePendingRevealFrame(watch)
    }
    schedulePendingRevealFrame(() => {
      if (cancelled) {
        return
      }
      const targetWorktreeStillExists = sidebarWorkspaceStillExists(
        pendingRevealWorktree.worktreeId,
        argsRef.current.worktrees,
        argsRef.current.folderWorkspaces
      )
      const targetIndex = findPreferredRenderRowIndexForWorktree(
        renderRows,
        pendingRevealWorktree.worktreeId,
        pinnedDisplayPolicy
      )
      const outcome = resolvePendingSidebarReveal({ targetIndex, targetWorktreeStillExists })
      if (outcome === 'clear') {
        finish()
        return
      }
      if (outcome !== 'scroll-and-clear') {
        // Why: give a passive reveal a few frames to unfold its row, then drop it rather than land when filters change.
        if (pendingRevealWorktree.passive && !retryPassiveReveal()) {
          finish()
        }
        return
      }
      const targetRow = renderRows[targetIndex]
      const container = argsRef.current.scrollRef.current
      const optionId = getRenderRowOptionId(targetRow, pendingRevealWorktree.worktreeId)
      const revealedOption = container
        ? revealMountedWorktreeElement(
            container,
            pendingRevealWorktree.worktreeId,
            pendingRevealWorktree.behavior,
            optionId,
            markRevealScroll
          )
        : null
      if (container && revealedOption) {
        recordScrollAnchorHere(container)
        if (!progress.announced) {
          progress.announced = true
          if (pendingRevealWorktree.highlight) {
            const revealedRowKey =
              revealedOption.dataset.worktreeRowKey ?? getRenderRowSidebarKey(targetRow)
            if (revealedRowKey) {
              flashRevealedRow(revealedRowKey)
            }
          }
          if (pendingRevealWorktree.beginRename) {
            setRenamingWorktreeId({
              worktreeId: pendingRevealWorktree.worktreeId,
              rowKey: revealedOption.dataset.worktreeRowKey
            })
          }
        }
        pendingRevealRetryRef.current = null
        holdLandedReveal(container, optionId)
        return
      }

      // Why: virtual indexing can leave the card edge clipped; stage it into the window, then retry the exact DOM reveal.
      virtualizer.scrollToIndex(targetIndex, { align: 'auto', behavior: 'auto' })
      recordScrollAnchorHere(container)
      progress.stagings += 1
      // Why time or attempts: a slow runner re-measures for many frames, a hidden window paints once a second.
      if (
        window.performance.now() - progress.startedAt < REVEAL_HOLD_MAX_MS ||
        progress.stagings < MAX_REVEAL_RETRIES
      ) {
        scheduleRetryTick(() => cancelled)
        return
      }
      finish()
    })
    return () => {
      cancelled = true
      cancelPendingRevealFrames()
    }
  }, [
    pendingRevealWorktree,
    args.agentSendTargetWorktreeId,
    args.groupBy,
    args.worktrees,
    args.folderWorkspaces,
    args.repoMap,
    args.prCache,
    args.worktreeLineageById,
    args.worktreeMap,
    renderRows,
    virtualizer,
    clearPendingRevealWorktreeId,
    args.toggleGroup,
    args.collapsedGroups,
    args.defaultHostId,
    args.agentStatusByWorktree,
    args.settings,
    pinnedDisplayPolicy,
    args.projectGrouping,
    args.projectGroups,
    pendingRevealRetryTick,
    flashRevealedRow,
    markRevealScroll,
    setRenamingWorktreeId,
    schedulePendingRevealFrame,
    cancelPendingRevealFrames,
    scheduleRetryTick
  ])

  usePendingSidebarRowReveal(args)
}

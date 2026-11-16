import type React from 'react'
import { useCallback, useEffect, useRef } from 'react'

export const RIGHT_SIDEBAR_TOGGLE_SELECTOR = '[data-right-sidebar-toggle]'

type RightSidebarDrawer = {
  showScrim: boolean
  tabIndex: number | undefined
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void
}

function focusVisibleToggle(): void {
  const toggle = Array.from(
    document.querySelectorAll<HTMLElement>(RIGHT_SIDEBAR_TOGGLE_SELECTOR)
  ).find((element) => element.getClientRects().length > 0)
  toggle?.focus()
}

/**
 * Drawer behaviour for the right panel when it overlays the content at narrow widths (ORCA-1220):
 * a scrim and Escape close it, focus moves in on open and back to the opener on close.
 */
export function useRightSidebarDrawer(args: {
  open: boolean
  overlay: boolean
  containerRef: React.RefObject<HTMLElement | null>
  onDismiss: () => void
}): RightSidebarDrawer {
  const { open, overlay, containerRef, onDismiss } = args
  const drawerOpen = open && overlay
  const overlayRef = useRef(overlay)
  overlayRef.current = overlay
  const openerRef = useRef<HTMLElement | null>(null)
  const managingFocusRef = useRef(false)

  useEffect(() => {
    const container = containerRef.current
    if (open) {
      // Why: only an open in drawer mode moves focus; widening or narrowing an open panel does not.
      if (!overlayRef.current || !container) {
        return
      }
      const active = document.activeElement
      managingFocusRef.current = true
      openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null
      if (!container.contains(document.activeElement)) {
        container.focus({ preventScroll: true })
      }
      return
    }
    if (!managingFocusRef.current) {
      return
    }
    managingFocusRef.current = false
    const opener = openerRef.current
    openerRef.current = null
    const active = document.activeElement
    // Why: a click outside already chose where focus goes; only reclaim focus the drawer held.
    const focusWasInDrawer =
      !active || active === document.body || (container?.contains(active) ?? false)
    if (!focusWasInDrawer) {
      return
    }
    if (opener?.isConnected) {
      opener.focus({ preventScroll: true })
    } else {
      // Why: the toggle that opened the panel unmounts while it is open, so its old node is gone.
      focusVisibleToggle()
    }
  }, [open, containerRef])

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      // Why: a menu or field inside the panel that handled Escape marks it handled; leave it be.
      if (!drawerOpen || event.key !== 'Escape' || event.defaultPrevented) {
        return
      }
      event.preventDefault()
      onDismiss()
    },
    [drawerOpen, onDismiss]
  )

  return {
    showScrim: drawerOpen,
    tabIndex: drawerOpen ? -1 : undefined,
    onKeyDown
  }
}

export function RightSidebarDrawerScrim({
  onDismiss
}: {
  onDismiss: () => void
}): React.JSX.Element {
  return (
    <div
      data-right-sidebar-scrim=""
      aria-hidden
      // Why: the dialog and sheet overlay treatment, so the drawer reads as the same layer.
      className="absolute inset-0 z-30 bg-black/55 backdrop-blur-[2px]"
      // Why: Electron's drag hit-test ignores z-index, so a scrim over the titlebar would drag the window.
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      onClick={onDismiss}
    />
  )
}

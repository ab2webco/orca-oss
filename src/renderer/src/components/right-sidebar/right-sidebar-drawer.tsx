import type React from 'react'
import { useEffect, useRef } from 'react'

export const RIGHT_SIDEBAR_TOGGLE_SELECTOR = '[data-right-sidebar-toggle]'

type RightSidebarDrawer = {
  showScrim: boolean
  tabIndex: number | undefined
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
  const openerRef = useRef<HTMLElement | null>(null)
  const managingFocusRef = useRef(false)

  // Why declared first: effects run in order, so the focus effect below reads this commit's value.
  useEffect(() => {
    overlayRef.current = overlay
  }, [overlay])

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

  useEffect(() => {
    if (!drawerOpen) {
      return
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return
      }
      const target = event.target
      const fromDrawer =
        target === document.body ||
        (target instanceof Node && containerRef.current?.contains(target))
      if (!fromDrawer) {
        return
      }
      event.preventDefault()
      onDismiss()
    }
    // Why window bubble: it runs after React and document listeners, so any field, menu or list
    // inside the panel that handled (or stopped) Escape keeps the drawer open.
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [drawerOpen, containerRef, onDismiss])

  return {
    showScrim: drawerOpen,
    tabIndex: drawerOpen ? -1 : undefined
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

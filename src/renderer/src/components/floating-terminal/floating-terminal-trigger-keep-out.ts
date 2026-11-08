import { useLayoutEffect, useSyncExternalStore } from 'react'
import {
  clampFloatingTerminalTriggerPosition,
  FLOATING_TERMINAL_TRIGGER_SIZE,
  type FloatingTerminalTriggerPosition
} from './floating-terminal-trigger-position'

/** A screen box the floating terminal button must not cover, such as the Team panel's action dock. */
export type FloatingTerminalKeepOut = { left: number; top: number; right: number; bottom: number }

const KEEP_OUT_GAP = 8

let keepOut: FloatingTerminalKeepOut | null = null
const listeners = new Set<() => void>()

function setKeepOut(next: FloatingTerminalKeepOut | null): void {
  const same =
    next && keepOut
      ? next.left === keepOut.left &&
        next.top === keepOut.top &&
        next.right === keepOut.right &&
        next.bottom === keepOut.bottom
      : next === keepOut
  if (same) {
    return
  }
  keepOut = next
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useFloatingTerminalKeepOut(): FloatingTerminalKeepOut | null {
  return useSyncExternalStore(
    subscribe,
    () => keepOut,
    () => null
  )
}

/** Publishes the element's box while it is mounted; it grows when the dock asks or replies. */
export function useFloatingTerminalKeepOutElement(element: HTMLElement | null): void {
  // Why every render too: the dock grows for a question or a reply, and a hidden or busy window delivers ResizeObserver late.
  useLayoutEffect(() => {
    if (element) {
      const { left, top, right, bottom } = element.getBoundingClientRect()
      setKeepOut({ left, top, right, bottom })
    }
  })
  useLayoutEffect(() => {
    if (!element) {
      return
    }
    const read = (): void => {
      const { left, top, right, bottom } = element.getBoundingClientRect()
      setKeepOut({ left, top, right, bottom })
    }
    read()
    const observer = new ResizeObserver(read)
    observer.observe(element)
    window.addEventListener('resize', read)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', read)
      setKeepOut(null)
    }
  }, [element])
}

/** Where the button is drawn: its own place, or just above the keep-out when they would overlap. */
export function placeFloatingTerminalTriggerClear(
  position: FloatingTerminalTriggerPosition,
  box: FloatingTerminalKeepOut | null
): FloatingTerminalTriggerPosition {
  const size = FLOATING_TERMINAL_TRIGGER_SIZE
  const overlaps =
    box !== null &&
    position.left < box.right &&
    position.left + size > box.left &&
    position.top < box.bottom &&
    position.top + size > box.top
  if (!overlaps) {
    return position
  }
  return clampFloatingTerminalTriggerPosition({
    left: position.left,
    top: box.top - size - KEEP_OUT_GAP
  })
}

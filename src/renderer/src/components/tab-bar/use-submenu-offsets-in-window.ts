import { useCallback, useRef, useState, type RefObject } from 'react'
import { submenuOffsetsInWindow } from './new-tab-submenu-fit'

/** Measures a submenu's trigger on open and returns the Radix offsets that keep it in the window. */
export function useSubmenuOffsetsInWindow(
  width: number,
  sideOffset: number
): {
  triggerRef: RefObject<HTMLDivElement | null>
  offsets: { sideOffset: number; alignOffset: number }
  onOpenChange: (open: boolean) => void
} {
  const triggerRef = useRef<HTMLDivElement | null>(null)
  const [offsets, setOffsets] = useState({ sideOffset, alignOffset: 0 })
  // Why on open: the + sits anywhere in the strip, so the room beside it is measured each time.
  const onOpenChange = useCallback(
    (open: boolean) => {
      const trigger = triggerRef.current
      if (open && trigger) {
        const rect = trigger.getBoundingClientRect()
        setOffsets(
          submenuOffsetsInWindow({
            trigger: { left: rect.left, right: rect.right, height: rect.height },
            width,
            sideOffset,
            viewportWidth: window.innerWidth
          })
        )
      }
    },
    [width, sideOffset]
  )
  return { triggerRef, offsets, onOpenChange }
}

// Drawer double for node tests whose subject is NOT the drawer; drawer behaviour is covered by the render project.
import { createElement, type ReactElement, type ReactNode } from 'react'

type DrawerDoubleProps = { visible: boolean; children?: ReactNode }

// Mirrors the real mount contract: a hidden drawer renders nothing.
export function BottomDrawer({ visible, children }: DrawerDoubleProps): ReactElement | null {
  return visible ? createElement('BottomDrawer', { visible }, children) : null
}

export function BottomDrawerModalHost({
  visible,
  children
}: DrawerDoubleProps): ReactElement | null {
  return visible ? createElement('BottomDrawerModalHost', { visible }, children) : null
}

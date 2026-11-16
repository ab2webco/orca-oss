import {
  isElementRevealedInScrollContainer,
  revealElementInScrollContainer
} from '../../worktree-sidebar-reveal'
import { getMountedWorktreeOptions, getWorktreeOptionId } from '../rows/option-dom'

function findMountedWorktreeElement(
  container: HTMLElement,
  worktreeId: string,
  optionId?: string
): HTMLElement | null {
  const element = optionId
    ? document.getElementById(optionId)
    : getMountedWorktreeOptions(worktreeId, container)[0]
  return element && container.contains(element) ? element : null
}

/** True when the worktree's row is mounted and sits where a reveal would leave it. */
export function isMountedWorktreeElementRevealed(
  container: HTMLElement,
  worktreeId: string,
  optionId?: string
): boolean {
  const element = findMountedWorktreeElement(container, worktreeId, optionId)
  return element !== null && isElementRevealedInScrollContainer(container, element)
}

export function revealMountedWorktreeElement(
  container: HTMLElement,
  worktreeId: string,
  behavior: ScrollBehavior,
  optionId?: string,
  onScrollIssued?: (targetTop: number) => void
): HTMLElement | null {
  const element = findMountedWorktreeElement(container, worktreeId, optionId)
  if (!element) {
    return null
  }
  return revealElementInScrollContainer(container, element, behavior, onScrollIssued)
    ? element
    : null
}

export function revealMountedSidebarRowElement(
  container: HTMLElement,
  rowKey: string,
  behavior: ScrollBehavior,
  onScrollIssued?: (targetTop: number) => void
): HTMLElement | null {
  const element = document.getElementById(getWorktreeOptionId(rowKey))
  if (!element || !container.contains(element)) {
    return null
  }
  return revealElementInScrollContainer(container, element, behavior, onScrollIssued)
    ? element
    : null
}

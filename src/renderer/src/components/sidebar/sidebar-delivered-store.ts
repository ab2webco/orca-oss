import { create } from 'zustand'
import type { GameHistoryRecord } from '../../../../shared/orchestrator-game-history'
import type { DeliveredMember, DeliveredPrKind } from './sidebar-delivered-members'

export type SidebarDeliveredState = {
  /** Freed members' worktrees under the lead, by worktree id (ORCA-1216 §6). */
  delivered: Record<string, DeliveredMember>
  /** The lead's history as last read, for the hover card's other tickets. */
  history: readonly GameHistoryRecord[]
  projectName: string | null
  /** PR numbers the lead's merge queue lists. */
  queuedPrNumbers: ReadonlySet<number>
  /** Each delivered card's PR state, which only the card reads; the lead's group folds by it. */
  prKindByWorktreeId: Record<string, DeliveredPrKind>
  /** Leads whose count row is open, and whose Delivered group is collapsed. */
  foldedOpenByLead: Record<string, true>
  collapsedByLead: Record<string, true>
}

// Why a store: the toggles must outlive the virtual list unmounting the lead's row on scroll.
export const useSidebarDeliveredStore = create<SidebarDeliveredState>(() => ({
  delivered: {},
  history: [],
  projectName: null,
  queuedPrNumbers: new Set(),
  prKindByWorktreeId: {},
  foldedOpenByLead: {},
  collapsedByLead: {}
}))

export function toggleDeliveredFlag(
  key: 'foldedOpenByLead' | 'collapsedByLead',
  leadWorktreeId: string
): void {
  useSidebarDeliveredStore.setState((state) => {
    const next = { ...state[key] }
    if (next[leadWorktreeId]) {
      delete next[leadWorktreeId]
    } else {
      next[leadWorktreeId] = true
    }
    return { [key]: next }
  })
}

export function noteDeliveredPrKind(worktreeId: string, kind: DeliveredPrKind | null): void {
  const current = useSidebarDeliveredStore.getState().prKindByWorktreeId
  if ((current[worktreeId] ?? null) === kind) {
    return
  }
  const next = { ...current }
  if (kind === null) {
    delete next[worktreeId]
  } else {
    next[worktreeId] = kind
  }
  useSidebarDeliveredStore.setState({ prKindByWorktreeId: next })
}

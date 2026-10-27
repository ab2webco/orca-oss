import type { PersistedUIState } from '../../../shared/persisted-ui-state-types'

// Why: main broadcasts the whole UI on every write (#5330), so a write that lands inside the
// renderer's debounce window would re-hydrate the stale value the renderer is about to replace.
let pendingWrite: Partial<PersistedUIState> | null = null

export function setPendingPersistedUIWrite(write: Partial<PersistedUIState>): void {
  pendingWrite = write
}

export function clearPendingPersistedUIWrite(write: Partial<PersistedUIState>): void {
  if (pendingWrite === write) {
    pendingWrite = null
  }
}

export function overlayPendingPersistedUIWrite(ui: PersistedUIState): PersistedUIState {
  return pendingWrite ? { ...ui, ...pendingWrite } : ui
}

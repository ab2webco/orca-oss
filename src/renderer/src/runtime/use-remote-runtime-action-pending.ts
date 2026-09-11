import { useCallback, useSyncExternalStore } from 'react'
import {
  isRemoteRuntimeActionPending,
  subscribeToRemoteRuntimeActions,
  type RemoteRuntimeActionKind
} from './web-runtime-pending-actions'

/**
 * True mientras haya una accion remota de ese tipo en vuelo para el workspace.
 *
 * Devuelve false para un workspace local: ahi la tab aparece al instante y un
 * spinner solo parpadearia.
 */
export function useRemoteRuntimeActionPending(
  environmentId: string | null | undefined,
  worktreeId: string | null | undefined,
  kind: RemoteRuntimeActionKind
): boolean {
  const getSnapshot = useCallback(
    () => isRemoteRuntimeActionPending(environmentId, worktreeId, kind),
    [environmentId, worktreeId, kind]
  )
  return useSyncExternalStore(subscribeToRemoteRuntimeActions, getSnapshot, getSnapshot)
}

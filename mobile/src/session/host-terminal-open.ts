import { AppState } from 'react-native'
import type { RpcClient } from '../transport/rpc-client'
import type { MobileSessionTab } from './mobile-session-route-types'

/** A terminal the host asked this phone to open, e.g. a member the game's View was tapped on. */
export type HostTerminalOpenRequest = { worktreeId: string; terminal: string; tabId: string }

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Only the screen showing the workspace the request came from follows it (ORCA-611). */
export function hostTerminalOpenRequestFor(
  payload: unknown,
  shownWorktreeId: string
): HostTerminalOpenRequest | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }
  const record = payload as Record<string, unknown>
  if (record.type !== 'openTerminal' || record.sourceWorktreeId !== shownWorktreeId) {
    return null
  }
  const worktreeId = nonEmptyString(record.worktreeId)
  const terminal = nonEmptyString(record.terminal)
  const tabId = nonEmptyString(record.tabId)
  return worktreeId && terminal && tabId ? { worktreeId, terminal, tabId } : null
}

export function hostTerminalOpenRoute(
  hostId: string,
  request: HostTerminalOpenRequest
): { pathname: '/h/[hostId]/session/[worktreeId]'; params: Record<string, string> } {
  return {
    pathname: '/h/[hostId]/session/[worktreeId]',
    params: {
      hostId,
      worktreeId: request.worktreeId,
      terminal: request.terminal,
      tab: request.tabId
    }
  }
}

/** By handle first; the host's tab id covers a handle reminted since the request was sent. */
export function sessionTabForHostOpen(
  tabs: readonly MobileSessionTab[],
  request: { terminal: string | undefined; tabId: string }
): MobileSessionTab | null {
  return (
    (request.terminal
      ? tabs.find((tab) => tab.type === 'terminal' && tab.terminal === request.terminal)
      : undefined) ??
    tabs.find(
      (tab) =>
        tab.type === 'terminal' && (tab.id === request.tabId || tab.parentTabId === request.tabId)
    ) ??
    null
  )
}

export function startHostTerminalOpenFollow({
  client,
  worktreeId,
  isFollowing,
  onOpen
}: {
  client: RpcClient
  worktreeId: string
  isFollowing: () => boolean
  onOpen: (request: HostTerminalOpenRequest) => void
}): () => void {
  let stopped = false
  const unsubscribe = client.subscribe(
    'runtime.clientEvents.subscribe',
    null,
    (payload: unknown) => {
      const request = hostTerminalOpenRequestFor(payload, worktreeId)
      // Why: a phone in a pocket or on another screen must not jump when the desktop clicks View.
      if (stopped || !request || !isFollowing() || AppState.currentState !== 'active') {
        return
      }
      onOpen(request)
    }
  )
  return () => {
    stopped = true
    unsubscribe()
  }
}

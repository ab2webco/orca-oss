import { useCallback, useEffect, useRef } from 'react'
import { useFocusEffect, useRouter } from 'expo-router'
import type { RpcClient } from '../transport/rpc-client'
import {
  hostTerminalOpenRoute,
  sessionTabForHostOpen,
  startHostTerminalOpenFollow,
  type TerminalOpenTarget
} from './host-terminal-open'
import type { MobileSessionTab } from './mobile-session-route-types'

type FollowHostTerminalOpenArgs = {
  client: RpcClient | null
  hostId: string
  worktreeId: string
  /** The `tab` (and `terminal`, when known) route params a followed request or member pushed. */
  routeTerminal: string | undefined
  routeTab: string | undefined
  sessionTabs: readonly MobileSessionTab[]
  selectTab: (tab: MobileSessionTab) => void
}

/** Follows a host request to open a terminal (the game's View) and selects it on arrival; returns the same opener. */
export function useFollowHostTerminalOpen({
  client,
  hostId,
  worktreeId,
  routeTerminal,
  routeTab,
  sessionTabs,
  selectTab
}: FollowHostTerminalOpenArgs): (target: TerminalOpenTarget) => void {
  const router = useRouter()
  const focusedRef = useRef(false)
  const sessionTabsRef = useRef(sessionTabs)
  const selectTabRef = useRef(selectTab)
  useEffect(() => {
    sessionTabsRef.current = sessionTabs
    selectTabRef.current = selectTab
  }, [selectTab, sessionTabs])

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true
      return () => {
        focusedRef.current = false
      }
    }, [])
  )

  const open = useCallback(
    (target: TerminalOpenTarget) => {
      if (target.worktreeId !== worktreeId) {
        // Why: a push keeps this screen under the member's, so back returns to the lead.
        router.push(hostTerminalOpenRoute(hostId, target))
        return
      }
      const tab = sessionTabForHostOpen(sessionTabsRef.current, {
        terminal: target.terminal ?? undefined,
        tabId: target.tabId
      })
      if (tab) {
        selectTabRef.current(tab)
      }
    },
    [hostId, router, worktreeId]
  )

  useEffect(() => {
    if (!client) {
      return
    }
    return startHostTerminalOpenFollow({
      client,
      worktreeId,
      isFollowing: () => focusedRef.current,
      onOpen: open
    })
  }, [client, open, worktreeId])

  const appliedRouteTerminalRef = useRef(false)
  useEffect(() => {
    if (appliedRouteTerminalRef.current || !routeTab) {
      return
    }
    // Why: the member's tabs arrive after mount; select once they include the requested one.
    const tab = sessionTabForHostOpen(sessionTabs, { terminal: routeTerminal, tabId: routeTab })
    if (tab) {
      appliedRouteTerminalRef.current = true
      selectTabRef.current(tab)
    }
  }, [routeTab, routeTerminal, sessionTabs])
  return open
}

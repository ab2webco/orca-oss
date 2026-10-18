import { useCallback, useEffect, useRef } from 'react'
import { useFocusEffect, useRouter } from 'expo-router'
import type { RpcClient } from '../transport/rpc-client'
import {
  hostTerminalOpenRoute,
  sessionTabForHostOpen,
  startHostTerminalOpenFollow,
  type HostTerminalOpenRequest
} from './host-terminal-open'
import type { MobileSessionTab } from './mobile-session-route-types'

type FollowHostTerminalOpenArgs = {
  client: RpcClient | null
  hostId: string
  worktreeId: string
  /** The `terminal`/`tab` route params a followed request pushed this screen with. */
  routeTerminal: string | undefined
  routeTab: string | undefined
  sessionTabs: readonly MobileSessionTab[]
  selectTab: (tab: MobileSessionTab) => void
}

/** Follows a host request to open a terminal (the game's View) and selects it on arrival. */
export function useFollowHostTerminalOpen({
  client,
  hostId,
  worktreeId,
  routeTerminal,
  routeTab,
  sessionTabs,
  selectTab
}: FollowHostTerminalOpenArgs): void {
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

  useEffect(() => {
    if (!client) {
      return
    }
    return startHostTerminalOpenFollow({
      client,
      worktreeId,
      isFollowing: () => focusedRef.current,
      onOpen: (request: HostTerminalOpenRequest) => {
        if (request.worktreeId !== worktreeId) {
          // Why: a push keeps this screen under the member's, so back returns to the lead.
          router.push(hostTerminalOpenRoute(hostId, request))
          return
        }
        const tab = sessionTabForHostOpen(sessionTabsRef.current, request)
        if (tab) {
          selectTabRef.current(tab)
        }
      }
    })
  }, [client, hostId, router, worktreeId])

  const appliedRouteTerminalRef = useRef(false)
  useEffect(() => {
    if (appliedRouteTerminalRef.current || !routeTerminal || !routeTab) {
      return
    }
    // Why: the member's tabs arrive after mount; select once they include the requested one.
    const tab = sessionTabForHostOpen(sessionTabs, { terminal: routeTerminal, tabId: routeTab })
    if (tab) {
      appliedRouteTerminalRef.current = true
      selectTabRef.current(tab)
    }
  }, [routeTab, routeTerminal, sessionTabs])
}

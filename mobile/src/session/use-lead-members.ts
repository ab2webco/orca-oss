import { useCallback, useState } from 'react'
import { AppState } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { getCachedWorktrees } from '../cache/worktree-cache'
import type { RpcClient } from '../transport/rpc-client'
import { leadMembersOf, readLeadCatalog, type LeadMember } from './lead-members'

const LEAD_MEMBERS_REFRESH_MS = 5_000

/** The members the active lead terminal launched, refreshed while this screen is in front. */
export function useLeadMembers({
  client,
  hostId,
  worktreeId,
  leadPaneKey
}: {
  client: RpcClient | null
  hostId: string
  worktreeId: string
  leadPaneKey: string | null
}): LeadMember[] {
  const [members, setMembers] = useState<LeadMember[]>([])

  useFocusEffect(
    useCallback(() => {
      if (!client || !leadPaneKey) {
        setMembers([])
        return
      }
      let stale = false
      const refresh = (): void => {
        if (AppState.currentState !== 'active') {
          return
        }
        void readLeadCatalog(client, hostId, getCachedWorktrees).then((catalog) => {
          // Why: a failed read keeps the last list rather than flashing the strip away.
          if (stale || !catalog) {
            return
          }
          const next = leadMembersOf(catalog, worktreeId, leadPaneKey)
          setMembers((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
        })
      }
      refresh()
      const interval = setInterval(refresh, LEAD_MEMBERS_REFRESH_MS)
      return () => {
        stale = true
        clearInterval(interval)
      }
    }, [client, hostId, leadPaneKey, worktreeId])
  )

  return members
}

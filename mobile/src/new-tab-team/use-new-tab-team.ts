import { useEffect, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import { readNewTabTeam, type NewTabTeam } from './new-tab-team-read'

const PENDING: NewTabTeam = { kind: 'pending' }
const NONE: NewTabTeam = { kind: 'none' }

/** Reads the Team group each time the + sheet opens; `supported` is null until the capability probe answers. */
export function useNewTabTeam(args: {
  client: RpcClient | null
  connected: boolean
  open: boolean
  supported: boolean | null
  worktreeId: string
}): NewTabTeam {
  const { client, connected, open, supported, worktreeId } = args
  const [team, setTeam] = useState<NewTabTeam>(PENDING)

  useEffect(() => {
    if (!client || !connected) {
      setTeam(NONE)
      return
    }
    if (!open || supported === null) {
      setTeam(PENDING)
      return
    }
    let stale = false
    void readNewTabTeam(client, { supported, worktreeId }).then((next) => {
      if (!stale) {
        setTeam(next)
      }
    })
    return () => {
      stale = true
    }
  }, [client, connected, open, supported, worktreeId])

  return team
}

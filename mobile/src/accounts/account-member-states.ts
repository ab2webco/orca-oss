import { useEffect, useState } from 'react'
import { hostCapabilitiesOf } from '../hosts/home-host-team-fetch'
import { readHostLeadStates } from '../hosts/host-team-read'
import { sendSingleFlightRequest } from '../transport/request-single-flight'
import type { RpcClient } from '../transport/rpc-client'

/** Each lead's game.state on a host, for naming who runs on each account; none from an older host. */
export async function readAccountMemberStates(
  client: RpcClient,
  hostId: string
): Promise<unknown[]> {
  try {
    const status = await sendSingleFlightRequest(client, hostId, 'status.get')
    if (!status.ok) {
      return []
    }
    return (await readHostLeadStates(client, hostCapabilitiesOf(status.result))) ?? []
  } catch {
    // Why empty: the names line is extra; a failed read must leave the accounts list as it was.
    return []
  }
}

/** Reads the lead states once per connection, so the Accounts screen can name each account's members. */
export function useAccountMemberStates(
  client: RpcClient | null,
  hostId: string | undefined,
  connected: boolean
): unknown[] {
  const [states, setStates] = useState<unknown[]>([])
  useEffect(() => {
    if (!client || !hostId || !connected) {
      return
    }
    let disposed = false
    void readAccountMemberStates(client, hostId).then((next) => {
      if (!disposed) {
        setStates(next)
      }
    })
    return () => {
      disposed = true
    }
  }, [client, hostId, connected])
  return states
}

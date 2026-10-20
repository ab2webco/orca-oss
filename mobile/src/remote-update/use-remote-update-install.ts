import * as LocalAuthentication from 'expo-local-authentication'
import { useCallback, useEffect, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { confirmRemoteUpdateInstall } from './remote-update-install-confirm'
import {
  describeMobileInstallResult,
  parseMobileInstallResult,
  parseRemoteUpdateOffer,
  type MobileInstallOutcome,
  type RemoteUpdateOffer
} from './remote-update-offer'

const CONFIRM_REFUSALS: Record<'no-device-lock' | 'failed', string> = {
  'no-device-lock': 'Set a passcode on this phone to install desktop updates from it.',
  failed: 'This phone could not confirm it is you, so nothing was sent to the desktop.'
}

function warning(message: string): MobileInstallOutcome {
  return { tone: 'warning', message, interrupted: [] }
}

export function useRemoteUpdateInstall(args: {
  client: RpcClient | null
  connState: ConnectionState
  supported: boolean
}): {
  offer: RemoteUpdateOffer | null
  outcome: MobileInstallOutcome | null
  busy: boolean
  install: () => Promise<void>
} {
  const { client, connState, supported } = args
  const [offer, setOffer] = useState<RemoteUpdateOffer | null>(null)
  const [outcome, setOutcome] = useState<MobileInstallOutcome | null>(null)
  const [busy, setBusy] = useState(false)
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    if (!client || connState !== 'connected' || !supported) {
      return
    }
    let cancelled = false
    client
      .sendRequest('updater.getStatus')
      .then((response) => {
        if (!cancelled && response.ok) {
          setOffer(parseRemoteUpdateOffer(response.result))
        }
      })
      // Why: the row is optional chrome; a failed read keeps the last offer instead of an error banner.
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [client, connState, generation, supported])

  const install = useCallback(async () => {
    if (!client || busy) {
      return
    }
    setBusy(true)
    setOutcome(null)
    try {
      const confirmation = await confirmRemoteUpdateInstall(LocalAuthentication)
      if (!confirmation.ok) {
        setOutcome(
          confirmation.reason === 'cancelled'
            ? null
            : warning(CONFIRM_REFUSALS[confirmation.reason])
        )
        return
      }
      // Why: `{}` because the host's params are strict; it installs only what its own feed offers.
      const response = await client.sendRequest('updater.requestMobileInstall', {})
      const result = response.ok ? parseMobileInstallResult(response.result) : null
      if (!result) {
        setOutcome(
          warning(
            response.ok
              ? 'The desktop sent a reply this app does not understand.'
              : `The desktop did not take the request: ${response.error.message}`
          )
        )
        return
      }
      setOutcome(describeMobileInstallResult(result))
      setGeneration((value) => value + 1)
    } catch (reason: unknown) {
      setOutcome(
        warning(
          `The desktop did not take the request: ${reason instanceof Error ? reason.message : String(reason)}`
        )
      )
    } finally {
      setBusy(false)
    }
  }, [busy, client])

  return { offer, outcome, busy, install }
}

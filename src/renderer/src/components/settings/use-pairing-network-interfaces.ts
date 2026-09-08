import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import {
  listPairingNetworkInterfaces,
  type PairingNetworkInterface
} from '@/runtime/runtime-pairing-interfaces'

type MountedRef = { readonly current: boolean }

export type PairingNetworkInterfacesState = {
  networkInterfaces: PairingNetworkInterface[]
  refreshing: boolean
  load: (options?: { showToastOnError?: boolean }) => Promise<void>
}

/** Load the addresses the pairing wizard can advertise, for the host that owns
 *  the pairing — this machine, or the active Orca server.
 *
 *  Why a hook and not inline state: three screens run the same refresh with the
 *  same stale-response guard, and the generator screen sits at its `max-lines`
 *  budget. The ratchet asks for a split rather than a grandfathered entry.
 */
export function usePairingNetworkInterfaces(
  mountedRef: MountedRef,
  activeRuntimeEnvironmentId: string | null | undefined
): PairingNetworkInterfacesState {
  const [networkInterfaces, setNetworkInterfaces] = useState<PairingNetworkInterface[]>([])
  const [refreshing, setRefreshing] = useState(false)
  // Why an id and not a boolean: a slow first call must not overwrite the result
  // of a refresh the user asked for afterwards.
  const loadIdRef = useRef(0)

  const load = useCallback(
    async (options: { showToastOnError?: boolean } = {}): Promise<void> => {
      const loadId = loadIdRef.current + 1
      loadIdRef.current = loadId
      const isCurrent = (): boolean => mountedRef.current && loadId === loadIdRef.current
      if (mountedRef.current) {
        setRefreshing(true)
      }
      try {
        const interfaces = await listPairingNetworkInterfaces(activeRuntimeEnvironmentId)
        if (isCurrent()) {
          setNetworkInterfaces(interfaces)
        }
      } catch {
        if (isCurrent() && options.showToastOnError) {
          toast.error(
            translate(
              'auto.components.settings.RuntimePairingUrlGenerator.95b8be4cea',
              'Failed to refresh network interfaces.'
            )
          )
        }
      } finally {
        if (isCurrent()) {
          setRefreshing(false)
        }
      }
    },
    [mountedRef, activeRuntimeEnvironmentId]
  )

  return { networkInterfaces, refreshing, load }
}

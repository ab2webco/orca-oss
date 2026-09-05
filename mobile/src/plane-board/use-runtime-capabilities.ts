import { useEffect, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'

/** The host capability list, or undefined until status.get answers. Callers gate
 *  Plane on it, so undefined must not read as "supported". */
export function useRuntimeCapabilities(
  client: RpcClient | null,
  connected: boolean
): readonly string[] | undefined {
  const [capabilities, setCapabilities] = useState<readonly string[] | undefined>(undefined)

  useEffect(() => {
    if (!client || !connected) {
      return
    }
    let stale = false
    void client
      .sendRequest('status.get')
      .then((response) => {
        if (stale || !response.ok) {
          return
        }
        const result = response.result as { capabilities?: unknown }
        const listed = Array.isArray(result.capabilities) ? result.capabilities : []
        const names: string[] = []
        for (const entry of listed) {
          if (typeof entry === 'string') {
            names.push(entry)
          }
        }
        setCapabilities(names)
      })
      .catch(() => {
        if (!stale) {
          setCapabilities([])
        }
      })
    return () => {
      stale = true
    }
  }, [client, connected])

  return capabilities
}

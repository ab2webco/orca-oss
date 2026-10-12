import { useCallback, useEffect, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { listHostablePluginPanels, type HostablePluginPanel } from './plugin-panel-list'

export function useHostPluginPanels(args: {
  client: RpcClient | null
  connState: ConnectionState
  supported: boolean
}): {
  panels: HostablePluginPanel[] | null
  error: string | null
  refreshing: boolean
  refresh: () => void
} {
  const { client, connState, supported } = args
  const [panels, setPanels] = useState<HostablePluginPanel[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    if (!client || connState !== 'connected' || !supported) {
      return
    }
    let cancelled = false
    setRefreshing(true)
    client
      .sendRequest('plugins.list')
      .then((response) => {
        if (cancelled) {
          return
        }
        if (response.ok) {
          setPanels(listHostablePluginPanels(response.result))
          setError(null)
        } else {
          setError(response.error.message)
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setRefreshing(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [client, connState, generation, supported])

  const refresh = useCallback(() => setGeneration((value) => value + 1), [])
  return { panels, error, refreshing, refresh }
}

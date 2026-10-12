import { useEffect, useMemo, useState } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { PluginPanelSession, type PluginPanelSessionState } from './plugin-panel-session'

export function useAppInForeground(): boolean {
  const [state, setState] = useState<AppStateStatus>(AppState.currentState)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', setState)
    return () => subscription.remove()
  }, [])
  // 'inactive' (app switcher, control center) keeps the session; only a real
  // background releases it.
  return state !== 'background'
}

export function usePluginPanelSession(args: {
  client: RpcClient | null
  connState: ConnectionState
  pluginKey: string
  panelId: string
}): {
  session: PluginPanelSession | null
  state: PluginPanelSessionState
  foreground: boolean
  deliveryUnknownAction: string | null
  dismissDeliveryUnknown: () => void
} {
  const { client, connState, pluginKey, panelId } = args
  const foreground = useAppInForeground()
  const [state, setState] = useState<PluginPanelSessionState>({ status: 'loading' })
  const [deliveryUnknownAction, setDeliveryUnknownAction] = useState<string | null>(null)

  const session = useMemo(
    () =>
      client
        ? new PluginPanelSession({
            client,
            pluginKey,
            panelId,
            onState: setState,
            onDeliveryUnknown: setDeliveryUnknownAction
          })
        : null,
    [client, panelId, pluginKey]
  )

  useEffect(() => {
    if (!session) {
      return
    }
    return () => session.dispose()
  }, [session])

  useEffect(() => {
    session?.setConditions({ connected: connState === 'connected', foreground })
  }, [connState, foreground, session])

  return {
    session,
    state,
    foreground,
    deliveryUnknownAction,
    dismissDeliveryUnknown: () => setDeliveryUnknownAction(null)
  }
}

import { useCallback, useEffect, useRef, useState } from 'react'
import type { GamePanelStyle } from '../../../src/shared/orchestrator-game-panel'
import { MOBILE_AGENT_TEAMS_SETTINGS_RUNTIME_CAPABILITY } from '../../../src/shared/protocol-version'
import type { RpcClient } from '../transport/rpc-client'
import { startRuntimeCapabilityProbe } from '../transport/runtime-capability-probe'
import { agentTeamsSettingsOf, type AgentTeamsSettings } from './agent-teams-settings-model'

export type AgentTeamsSettingsState =
  | { kind: 'loading' }
  | { kind: 'unsupported' }
  | { kind: 'failed'; message: string }
  | { kind: 'ready'; settings: AgentTeamsSettings; saveError: string | null }

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** Reads and writes the host's global Agent Teams settings, gated on its capability. */
export function useAgentTeamsSettings(args: { client: RpcClient | null; connected: boolean }) {
  const { client, connected } = args
  const [supported, setSupported] = useState<boolean | null>(null)
  const [state, setState] = useState<AgentTeamsSettingsState>({ kind: 'loading' })
  const settingsRef = useRef<AgentTeamsSettings | null>(null)

  useEffect(() => {
    if (!client || !connected) {
      return
    }
    return startRuntimeCapabilityProbe(client, (capabilities) =>
      setSupported(capabilities.includes(MOBILE_AGENT_TEAMS_SETTINGS_RUNTIME_CAPABILITY))
    )
  }, [client, connected])

  useEffect(() => {
    if (!client || supported === null) {
      return
    }
    if (!supported) {
      setState({ kind: 'unsupported' })
      return
    }
    let stale = false
    void client
      .sendRequest('settings.get')
      .then((response) => {
        if (stale) {
          return
        }
        const settings = response.ok ? agentTeamsSettingsOf(response.result) : null
        settingsRef.current = settings
        setState(
          settings
            ? { kind: 'ready', settings, saveError: null }
            : response.ok
              ? { kind: 'unsupported' }
              : { kind: 'failed', message: response.error.message }
        )
      })
      .catch((error: unknown) => {
        if (!stale) {
          setState({ kind: 'failed', message: errorText(error) })
        }
      })
    return () => {
      stale = true
    }
  }, [client, supported])

  // Why optimistic: the row shows the pick at once; a refused save puts the old value back.
  const save = useCallback(
    (next: AgentTeamsSettings, update: Record<string, unknown>) => {
      const previous = settingsRef.current
      if (!client || !previous) {
        return
      }
      settingsRef.current = next
      setState({ kind: 'ready', settings: next, saveError: null })
      const revert = (message: string) => {
        if (settingsRef.current === next) {
          settingsRef.current = previous
          setState({ kind: 'ready', settings: previous, saveError: `Could not save: ${message}` })
        }
      }
      void client
        .sendRequest('settings.update', update)
        .then((response) => {
          if (!response.ok) {
            revert(response.error.message)
          }
        })
        .catch((error: unknown) => revert(errorText(error)))
    },
    [client]
  )

  const current = (): AgentTeamsSettings | null => settingsRef.current

  return {
    state,
    setScene: (scene: string) => {
      const now = current()
      if (now) {
        save({ ...now, scene }, { agentTeamsPanel: { scene } })
      }
    },
    setStyle: (style: GamePanelStyle) => {
      const now = current()
      if (now) {
        save({ ...now, style }, { agentTeamsPanel: { style } })
      }
    }
  }
}

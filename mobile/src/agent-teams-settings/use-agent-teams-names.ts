import { useEffect, useRef, useState } from 'react'
import type {
  AgentTeamsNamesSettings,
  AgentTeamsNamesUpdate
} from '../../../src/shared/agent-teams-names-settings'
import { MOBILE_AGENT_TEAMS_NAMES_RUNTIME_CAPABILITY } from '../../../src/shared/protocol-version'
import type { RpcClient } from '../transport/rpc-client'
import { startRuntimeCapabilityProbe } from '../transport/runtime-capability-probe'
import { namesFromSettingsGet } from './agent-teams-names-model'

export type AgentTeamsNamesState =
  | { kind: 'loading' | 'unsupported' }
  | { kind: 'failed'; message: string }
  | { kind: 'ready'; names: AgentTeamsNamesSettings; saveError: string | null }

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** The host's global lead and member names, gated on its own capability (ORCA-1304). */
export function useAgentTeamsNames(args: { client: RpcClient | null; connected: boolean }) {
  const { client, connected } = args
  const [state, setState] = useState<AgentTeamsNamesState>({ kind: 'loading' })
  const namesRef = useRef<AgentTeamsNamesSettings | null>(null)

  useEffect(() => {
    if (!client || !connected) {
      return
    }
    let stale = false
    const show = (next: AgentTeamsNamesState) => !stale && setState(next)
    const stopProbe = startRuntimeCapabilityProbe(client, (capabilities) => {
      // Why: settings.update is strict, so an older host would refuse agentTeamsNames.
      if (!capabilities.includes(MOBILE_AGENT_TEAMS_NAMES_RUNTIME_CAPABILITY)) {
        show({ kind: 'unsupported' })
        return
      }
      void client
        .sendRequest('settings.get')
        .then((response) => {
          if (stale) {
            return
          }
          const names = response.ok ? namesFromSettingsGet(response.result) : null
          namesRef.current = names
          show(
            names
              ? { kind: 'ready', names, saveError: null }
              : response.ok
                ? { kind: 'unsupported' }
                : { kind: 'failed', message: response.error.message }
          )
        })
        .catch((error: unknown) => show({ kind: 'failed', message: errorText(error) }))
    })
    return () => {
      stale = true
      stopProbe()
    }
  }, [client, connected])

  // Why optimistic: the row shows the name at once; a refused save puts the old one back.
  const save = (update: AgentTeamsNamesUpdate) => {
    const previous = namesRef.current
    if (!client || !previous) {
      return
    }
    const next = { ...previous, ...update } as AgentTeamsNamesSettings
    namesRef.current = next
    setState({ kind: 'ready', names: next, saveError: null })
    const revert = (message: string) => {
      if (namesRef.current === next) {
        namesRef.current = previous
        setState({ kind: 'ready', names: previous, saveError: `Could not save: ${message}` })
      }
    }
    void client
      .sendRequest('settings.update', { agentTeamsNames: update })
      .then((response) => {
        if (!response.ok) {
          revert(response.error.message)
        }
      })
      .catch((error: unknown) => revert(errorText(error)))
  }

  return {
    state,
    setLeadName: (leadName: string | null) => save({ leadName }),
    setMemberNames: (memberNames: string[] | null) => save({ memberNames })
  }
}

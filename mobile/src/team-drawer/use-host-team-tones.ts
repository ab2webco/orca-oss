import { useEffect, useState } from 'react'
import { darkStatusColorsOf } from '../agent-teams-settings/agent-teams-settings-model'
import type { RpcClient } from '../transport/rpc-client'
import { TEAM_TONE_DEFAULTS, teamTonesOf, type TeamTones } from './team-status-tone'

/** The host's status colours, read again each time the Team shows, so a Settings edit lands on return. */
export function useHostTeamTones(client: RpcClient | null, active: boolean): TeamTones {
  const [tones, setTones] = useState<TeamTones>(TEAM_TONE_DEFAULTS)
  useEffect(() => {
    if (!client || !active) {
      return
    }
    let stale = false
    void client
      .sendRequest('settings.get')
      .then((response) => {
        if (!stale && response.ok) {
          setTones(teamTonesOf(darkStatusColorsOf(response.result)))
        }
      })
      // Why keep the last tones: a failed read says nothing about the person's colours.
      .catch(() => {})
    return () => {
      stale = true
    }
  }, [active, client])
  return tones
}

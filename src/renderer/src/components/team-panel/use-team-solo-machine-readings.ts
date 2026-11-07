import { useEffect, useState } from 'react'
import { callRuntimeRpc, type RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import {
  gameHostMachineOf,
  type GameHostReading
} from '../../../../shared/orchestrator-game-host-capacity'
import { TEAM_LOCAL_HOST_KEY } from '../../../../shared/team-panel-solo-machines'

const READ_MS = 20_000
const READ_TIMEOUT_MS = 15_000

// Why diagnostics.memory: every paired host already answers it, so no wire change, as for a team.
async function readingOf(target: RuntimeClientTarget): Promise<GameHostReading> {
  const snapshot = await callRuntimeRpc<{ host?: unknown }>(
    target,
    'diagnostics.memory',
    undefined,
    { timeoutMs: READ_TIMEOUT_MS }
  ).catch(() => null)
  const machine = gameHostMachineOf(snapshot?.host)
  return machine ? { kind: 'ok', machine } : { kind: 'unreachable' }
}

/**
 * Each machine by host key, null until one lands; `environmentIds` is joined by newlines.
 * Why only while shown: each read is a `ps` sweep on the host.
 */
export function useTeamSoloMachineReadings(
  environmentIds: string,
  active: boolean
): ReadonlyMap<string, GameHostReading> | null {
  const [readings, setReadings] = useState<ReadonlyMap<string, GameHostReading> | null>(null)
  useEffect(() => {
    if (!active) {
      return
    }
    let live = true
    // Why one by one: a dead host takes the whole timeout, and the others must not wait for it.
    const land = (key: string, target: RuntimeClientTarget): void => {
      void readingOf(target).then((reading) => {
        if (live) {
          setReadings((held) => new Map(held).set(key, reading))
        }
      })
    }
    const read = (): void => {
      land(TEAM_LOCAL_HOST_KEY, { kind: 'local' })
      for (const environmentId of environmentIds.split('\n').filter(Boolean)) {
        land(environmentId, { kind: 'environment', environmentId })
      }
    }
    read()
    const timer = setInterval(read, READ_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [active, environmentIds])
  return readings
}

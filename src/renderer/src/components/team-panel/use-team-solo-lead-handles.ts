import { useEffect, useState } from 'react'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { hasRuntimeRpcErrorCode } from '@/runtime/runtime-rpc-result'
import { TEAM_LOCAL_HOST_KEY } from '../../../../shared/team-panel-solo-machines'
import { readTeamLeads } from './team-panel-lead-read'

// Why 30 s: as the sidebar crown; game.leads is the host's in-memory lead registry.
const READ_MS = 30_000
const NONE: ReadonlySet<string> = new Set()

/** A host's live lead handles; null keeps the last read, since one failure dethrones nobody. */
export async function readSoloLeadHandles(
  target: RuntimeClientTarget,
  read: typeof readTeamLeads = readTeamLeads
): Promise<ReadonlySet<string> | null> {
  try {
    return new Set((await read(target)).map((lead) => lead.handle))
  } catch (error) {
    // Why: a host older than the game has no leads to list.
    return hasRuntimeRpcErrorCode(error, 'method_not_found') ? NONE : null
  }
}

/**
 * Lead handles by host key (this machine is ''), for every host the no-team view shows; SSH
 * panes run under this machine's runtime. `environmentIds` is joined by newlines.
 */
export function useTeamSoloLeadHandles(
  environmentIds: string,
  active: boolean
): ReadonlyMap<string, ReadonlySet<string>> {
  const [handles, setHandles] = useState<ReadonlyMap<string, ReadonlySet<string>>>(new Map())
  useEffect(() => {
    if (!active) {
      return
    }
    let live = true
    // Why one by one: a dead host takes the whole timeout, and the others must not wait for it.
    const land = (key: string, target: RuntimeClientTarget): void => {
      void readSoloLeadHandles(target).then((read) => {
        if (live && read) {
          setHandles((held) => new Map(held).set(key, read))
        }
      })
    }
    const readAll = (): void => {
      land(TEAM_LOCAL_HOST_KEY, { kind: 'local' })
      for (const environmentId of environmentIds.split('\n').filter(Boolean)) {
        land(environmentId, { kind: 'environment', environmentId })
      }
    }
    readAll()
    const timer = setInterval(readAll, READ_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [active, environmentIds])
  return handles
}
